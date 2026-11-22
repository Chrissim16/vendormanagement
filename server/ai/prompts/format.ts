/**
 * How the AI is asked to write formatted text (Q-12): the subset of Markdown that
 * shared/richtext reads. Anything else the model writes is read as plain words.
 */
export const FORMAT_RULES = [
  "paragraphs separated by an empty line;",
  '"## " for a sub-heading and "### " for a smaller one;',
  'lines starting with "- " for a bullet list and "1. ", "2. " for a numbered list, one level only;',
  "**bold** and *italic*;",
  'a table as lines starting and ending with "|", the first row being the header, followed by a "| --- | --- |" row.',
  "No other Markdown: no links, no code, no quotes, no images, no nested lists.",
].join(" ");
