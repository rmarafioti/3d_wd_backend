// The post body in the API: element rows (selected ordered by position, with `type`, `text` and
// a nested `image` select) → the contract's body list. Shared by the site owner and public routes,
// which select different image fields (the public one has no ids).

// Element rows → [{ type: 'paragraph', text } | { type: 'image', image }].
function toBody(elements) {
  return elements.map(({ type, text, image }) =>
    type === 'paragraph' ? { type, text } : { type, image },
  );
}

module.exports = { toBody };
