/** Stops generation at end-of-turn for ChatML / Gemma-style templates (llama-server often needs these). */
export const CHAT_TEMPLATE_STOP_SEQUENCES = [
  '<|im_end|>',
  '<|im_end|>',
  '<|im_start|>',
  '<|redacted_im_start|>',
  '<|endoftext|>',
  '<|eot_id|>',
  '<|end_of_turn|>',
  '</s>',
];

/**
 * Models sometimes emit the next turn's template tokens; cut those off before showing the user.
 */
export function sanitizeChatCompletionText(text) {
  if (typeof text !== 'string') return '';
  let s = text;
  const truncateBefore = ['<|im_start|>', '<|redacted_im_start|>'];
  for (const m of truncateBefore) {
    const i = s.indexOf(m);
    if (i !== -1) s = s.slice(0, i);
  }
  s = s.replace(/<\|(?:redacted_)?im_end\|>/gi, '');
  s = s.replace(/<\|eot_id\|>/g, '');
  s = s.replace(/<\|endoftext\|>/gi, '');
  return s.trim();
}
