// The post body in the API: element rows → the contract's body list, shared by the site owner and
// public routes.

// Element rows → [{ type: 'paragraph', text } | { type: 'image', image }].
function toBody(elements) {
  return elements.map(({ type, text, image }) =>
    type === 'paragraph' ? { type, text } : { type, image },
  );
}

module.exports = { toBody };
