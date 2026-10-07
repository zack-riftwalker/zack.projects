#!/usr/bin/env python3
"""Export the legacy SQLite databases (storefront.db, monshi.db) as SQL files for Cloudflare D1.

    python3 scripts/sqlite_to_d1.py --store /path/storefront.db --monshi /path/monshi.db --out-dir migration_out

Apply AFTER `npm run db:migrate:remote` (schema must exist) and BEFORE opening /setup:

    npx wrangler d1 execute store-bot-db  --remote --file=migration_out/store_data.sql
    npx wrangler d1 execute monshi-bot-db --remote --file=migration_out/monshi_data.sql

Notes
  * Standard library only. Source databases are opened read-only (keep the -wal/-shm files next to the .db
    so the newest writes are included). If a read-only open is impossible the files are copied to a temp dir first.
  * Every INSERT lists its columns explicitly — the legacy column order may differ because of ALTER TABLE history.
    Only columns that exist in BOTH the source and the target schema are written (missing ones take their defaults).
  * `faqs.embedding` is always NULL (the Worker recomputes 768-dim embeddings); settings.embedding_version is
    forced to '3-768'. `sessions` (in-progress wizards) are not migrated.
  * No BEGIN/COMMIT (D1 rejects them); foreign keys are deferred.
  * The output contains customer data — never commit migration_out/.
"""
import argparse
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

MAX_STATEMENT_BYTES = 100_000
EMBEDDING_VERSION = "3-768"

# (table, target columns) in import order — must match migrations/*/*.sql (guarded by a test).
STORE_TABLES = [
    ("customers", ["id", "telegram_id", "display_name", "created_at", "ref_code"]),
    ("customer_products", ["id", "name", "price", "terms_text", "terms_entities", "duration_days", "warranty_days", "is_active", "created_at", "is_available"]),
    ("discount_codes", ["id", "code", "customer_product_id", "discount_type", "discount_value", "max_uses", "expires_at", "is_active", "created_at", "owner_telegram_id", "source"]),
    ("orders", ["id", "customer_telegram_id", "customer_product_id", "product_name", "price", "receipt_file_id", "receipt_type",
                "purchase_source", "status", "created_at", "decided_at", "decided_by", "discount_code_id", "duration_days",
                "warranty_days", "delivered_at", "expires_at", "warranty_expires_at", "reminded_7d", "reminded_3d",
                "reminded_expired", "stalled_alert_sent", "last_warranty_claim_at", "paid_failed_handled", "reject_reason", "receipt_unique_id"]),
    ("discount_code_redemptions", ["id", "discount_code_id", "customer_telegram_id", "order_id", "redeemed_at"]),
    ("manual_purchase_claims", ["id", "creation_key", "token_hash", "customer_product_id", "product_name", "price", "duration_days",
                                "warranty_days", "approved_by", "approved_at", "status", "claimed_by", "claimed_at", "order_id"]),
    ("store_settings", ["id", "card_number", "card_holder_name"]),
]
STORE_REPLACE = {"store_settings"}

MONSHI_TABLES = [
    ("settings", ["key", "value"]),
    ("connection", ["business_connection_id", "owner_user_id", "is_enabled", "updated_at"]),
    ("customers", ["chat_id", "telegram_user_id", "username", "first_name", "first_seen_at", "last_message_at", "is_blocked",
                   "automation_paused_until", "last_ack_sent_at"]),
    ("faqs", ["id", "question", "answer", "keywords", "enabled", "priority", "embedding", "hit_count", "created_at", "updated_at"]),
    ("messages", ["id", "chat_id", "telegram_message_id", "direction", "message_type", "text", "received_at", "answered_by", "faq_id",
                  "business_connection_id"]),
    ("unanswered", ["id", "chat_id", "text", "normalized_text", "count", "last_seen_at", "status", "last_message_row_id"]),
    ("reply_log", ["chat_id", "reply_key", "sent_at"]),
    ("orders", ["id", "chat_id", "title", "status", "checklist_message_id", "business_connection_id", "note", "external_order_id",
                "created_at", "updated_at"]),
]
MONSHI_REPLACE = {"settings"}
NULL_COLUMNS = {("faqs", "embedding")}  # always exported as NULL


def literal(value, table, column):
    if (table, column) in NULL_COLUMNS or value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    return "'" + str(value).replace("'", "''") + "'"


def open_readonly(path):
    """Open read-only; fall back to a temp copy (with -wal/-shm) when that is not possible."""
    path = Path(path)
    if not path.exists():
        sys.exit(f"error: {path} does not exist")
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        conn.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchall()
        return conn, None
    except sqlite3.Error:
        tmp = tempfile.mkdtemp(prefix="sqlite_to_d1_")
        for suffix in ("", "-wal", "-shm"):
            src = Path(str(path) + suffix)
            if src.exists():
                shutil.copy2(src, Path(tmp) / (path.name + suffix))
        return sqlite3.connect(Path(tmp) / path.name), tmp


def export(db_path, tables, replace, header, forced_rows=()):
    conn, tmp = open_readonly(db_path)
    conn.row_factory = sqlite3.Row
    counts = {}
    out = [header, "PRAGMA defer_foreign_keys = true;"]
    try:
        existing = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table, target_cols in tables:
            if table not in existing:
                print(f"  warning: table {table} not found in {db_path} — skipped")
                counts[table] = (0, 0)
                continue
            src_cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})")]
            cols = [c for c in target_cols if c in src_cols]
            if not cols:
                counts[table] = (0, 0)
                continue
            verb = "INSERT OR REPLACE" if table in replace else "INSERT"
            n_src = n_out = 0
            for row in conn.execute(f"SELECT {', '.join(cols)} FROM {table}"):
                n_src += 1
                stmt = f"{verb} INTO {table} ({', '.join(cols)}) VALUES ({', '.join(literal(row[c], table, c) for c in cols)});"
                if len(stmt.encode("utf-8")) > MAX_STATEMENT_BYTES:
                    sys.exit(f"error: a row of {table} exceeds D1's {MAX_STATEMENT_BYTES}-byte statement limit — cannot export")
                out.append(stmt)
                n_out += 1
            counts[table] = (n_src, n_out)
    finally:
        conn.close()
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
    out.extend(forced_rows)
    return "\n".join(out) + "\n", counts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", help="path to the legacy storefront.db")
    ap.add_argument("--monshi", help="path to the legacy monshi.db")
    ap.add_argument("--out-dir", default="migration_out")
    ap.add_argument("--print-columns", action="store_true", help="print the hard-coded target columns as JSON and exit (used by tests)")
    args = ap.parse_args()

    if args.print_columns:
        print(json.dumps({"store": dict(STORE_TABLES), "monshi": dict(MONSHI_TABLES)}))
        return
    if not args.store and not args.monshi:
        ap.error("give --store and/or --monshi")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.store:
        sql, counts = export(args.store, STORE_TABLES, STORE_REPLACE, "-- store bot data (generated by sqlite_to_d1.py)")
        (out_dir / "store_data.sql").write_text(sql, encoding="utf-8")
        print(f"store → {out_dir / 'store_data.sql'}")
        for table, (src, out) in counts.items():
            print(f"  {table:28s} source rows: {src:6d}   exported: {out:6d}")
    if args.monshi:
        forced = [f"INSERT OR REPLACE INTO settings (key, value) VALUES ('embedding_version', '{EMBEDDING_VERSION}');"]
        sql, counts = export(args.monshi, MONSHI_TABLES, MONSHI_REPLACE, "-- monshi bot data (generated by sqlite_to_d1.py)", forced)
        (out_dir / "monshi_data.sql").write_text(sql, encoding="utf-8")
        print(f"monshi → {out_dir / 'monshi_data.sql'}")
        for table, (src, out) in counts.items():
            print(f"  {table:28s} source rows: {src:6d}   exported: {out:6d}")
    print("\nNext: run `wrangler d1 execute ... --remote --file=...` for each file (after db:migrate:remote).")
    print("migration_out/ contains customer data — do NOT commit it.")


if __name__ == "__main__":
    main()
