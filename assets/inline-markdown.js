// A deliberately small inline grammar: emphasis, strong emphasis, and escaped stars.
// All source text is escaped; HTML and Markdown links are never interpreted.
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function inlineNodes(value) {
  const text = String(value ?? '');
  const root = { children: [] };
  const stack = [root];
  const appendText = value => {
    const children = stack.at(-1).children;
    const previous = children.at(-1);
    if (previous && Object.hasOwn(previous, 'text')) previous.text += value;
    else children.push({ text: value });
  };
  for (let index = 0; index < text.length;) {
    if (text[index] === '\\' && /[\\*]/u.test(text[index + 1] ?? '')) {
      appendText(text[index + 1]);
      index += 2;
      continue;
    }
    if (text[index] !== '*') {
      appendText(text[index++]);
      continue;
    }
    let end = index;
    while (text[end] === '*') end++;
    let remaining = end - index;
    if (remaining > 3) {
      appendText(text.slice(index, end));
      index = end;
      continue;
    }
    const before = text[index - 1];
    const after = text[end];
    const canClose = before !== undefined && !/\s/u.test(before);
    const canOpen = after !== undefined && !/\s/u.test(after);
    // Closing from the inside out also handles a bold span ending in an italic name.
    while (canClose && stack.length > 1 && remaining >= stack.at(-1).marker.length) {
      const node = stack.pop();
      node.closed = true;
      remaining -= node.marker.length;
    }
    while (remaining && canOpen && stack.length < 17) {
      const marker = remaining >= 2 ? '**' : '*';
      const node = { marker, closed: false, children: [] };
      stack.at(-1).children.push(node);
      stack.push(node);
      remaining -= marker.length;
    }
    if (remaining) appendText('*'.repeat(remaining));
    index = end;
  }
  return root.children;
}

function plainNodes(nodes) {
  return nodes.map(node => node.children
    ? (node.closed ? '' : node.marker) + plainNodes(node.children)
    : node.text).join('');
}

function htmlNodes(nodes) {
  return nodes.map(node => {
    if (!node.children) return escapeHTML(node.text);
    const content = htmlNodes(node.children);
    if (!node.closed) return escapeHTML(node.marker) + content;
    return node.marker.length === 1 ? '<em>' + content + '</em>' : '<strong>' + content + '</strong>';
  }).join('');
}

export function formatInline(value) {
  return htmlNodes(inlineNodes(value));
}

export function plainInline(value) {
  return plainNodes(inlineNodes(value));
}
