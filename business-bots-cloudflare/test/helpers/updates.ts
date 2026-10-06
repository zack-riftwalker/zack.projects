let uid = 1;
let mid = 100;

export interface User { id: number; first_name?: string; username?: string }

const u = (user: User) => ({ id: user.id, is_bot: false, first_name: user.first_name ?? 'User' + user.id, username: user.username });

export function textUpdate(user: User, text: string, chatId = user.id): any {
  const entities: any[] = [];
  const cmd = text.match(/^\/[A-Za-z0-9_]+(@\w+)?/);
  if (cmd) entities.push({ type: 'bot_command', offset: 0, length: cmd[0].length });
  return {
    update_id: uid++,
    message: {
      message_id: mid++, date: 1700000000, chat: { id: chatId, type: 'private', first_name: user.first_name ?? 'User' }, from: u(user), text,
      ...(entities.length ? { entities } : {}),
    },
  };
}

export function textWithEntities(user: User, text: string, entities: any[]): any {
  const upd = textUpdate(user, text);
  upd.message.entities = entities;
  return upd;
}

export function callbackUpdate(user: User, data: string, message: { caption?: string; text?: string; chatId?: number; message_id?: number } = {}): any {
  const chatId = message.chatId ?? user.id;
  return {
    update_id: uid++,
    callback_query: {
      id: 'cb' + uid, from: u(user), chat_instance: 'ci', data,
      message: {
        message_id: message.message_id ?? mid++, date: 1700000000, chat: { id: chatId, type: 'private' },
        ...(message.caption !== undefined ? { caption: message.caption, photo: [{ file_id: 'p', file_unique_id: 'p', width: 1, height: 1 }] } : { text: message.text ?? 'x' }),
      },
    },
  };
}

export function photoUpdate(user: User, fileId = 'photo-large'): any {
  return {
    update_id: uid++,
    message: {
      message_id: mid++, date: 1700000000, chat: { id: user.id, type: 'private' }, from: u(user),
      photo: [
        { file_id: 'small', file_unique_id: 's', width: 10, height: 10 },
        { file_id: fileId, file_unique_id: 'l', width: 100, height: 100 },
      ],
    },
  };
}

export function documentUpdate(user: User, fileId = 'doc-1'): any {
  return {
    update_id: uid++,
    message: {
      message_id: mid++, date: 1700000000, chat: { id: user.id, type: 'private' }, from: u(user),
      document: { file_id: fileId, file_unique_id: 'd' },
    },
  };
}

export function voiceUpdate(user: User): any {
  return {
    update_id: uid++,
    message: {
      message_id: mid++, date: 1700000000, chat: { id: user.id, type: 'private' }, from: u(user),
      voice: { file_id: 'v', file_unique_id: 'v', duration: 3 },
    },
  };
}

export function businessConnectionUpdate(owner: User, id = 'bc1', isEnabled = true, rights = { can_reply: true, can_read_messages: true }): any {
  return {
    update_id: uid++,
    business_connection: { id, user: u(owner), user_chat_id: owner.id, date: 1700000000, rights, is_enabled: isEnabled },
  };
}

export function businessMessageUpdate(sender: User, text: string | undefined, opts: { bcid?: string; chatId?: number; extra?: Record<string, unknown> } = {}): any {
  const chatId = opts.chatId ?? sender.id;
  return {
    update_id: uid++,
    business_message: {
      message_id: mid++, date: 1700000000, business_connection_id: opts.bcid ?? 'bc1',
      chat: { id: chatId, type: 'private', first_name: sender.first_name ?? 'C' }, from: u(sender),
      ...(text !== undefined ? { text } : {}), ...(opts.extra ?? {}),
    },
  };
}
