/* Runs in the page's MAIN world.
 *
 * Highlights and inline formats wrap pieces of Claude's text in
 * <span data-csr-wrap>. React still holds references to the original text
 * nodes, so if it ever removes/inserts next to one of them it would throw
 * "The node to be removed is not a child of this node" and crash the page.
 * These two small patches only kick in for nodes that sit inside one of our
 * wrappers and forward the call to the right parent. */
(() => {
  if (window.__csrGuardInstalled) return;
  window.__csrGuardInstalled = true;

  const isWrap = (n) => !!n && n.nodeType === 1 && n.hasAttribute('data-csr-wrap');

  // Walk up from `node` through our wrappers until reaching a direct child of `parent`.
  const outermostWrapIn = (parent, node) => {
    let cur = node;
    while (cur && cur.parentNode !== parent) {
      if (!isWrap(cur.parentNode)) return null;
      cur = cur.parentNode;
    }
    return cur;
  };

  const removeChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (child && child.parentNode !== this && isWrap(child.parentNode) && outermostWrapIn(this, child)) {
      return removeChild.call(child.parentNode, child);
    }
    return removeChild.call(this, child);
  };

  const insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (node, ref) {
    if (ref && ref.parentNode !== this && isWrap(ref.parentNode)) {
      const top = outermostWrapIn(this, ref);
      if (top) return insertBefore.call(this, node, top);
    }
    return insertBefore.call(this, node, ref);
  };
})();
