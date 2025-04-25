// server/src/services/tokenizer.js
// Simple tokenizer implementation with cross-platform compatibility

/**
 * Encode text into tokens (simple whitespace/punctuation split approach)
 * @param {string} text - Text to tokenize
 * @returns {Array<number>} - Array of token IDs
 */
function encode(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  
  // Simple word and punctuation tokenization
  const tokens = text
    .toLowerCase()
    .replace(/([.,!?;:()])/g, ' $1 ') // Add spaces around punctuation
    .replace(/\s+/g, ' ')             // Normalize whitespace
    .trim()
    .split(' ')
    .filter(token => token.length > 0);
  
  // Convert tokens to numeric IDs using simple hashing
  return tokens.map(token => {
    // Simple hash function for tokens
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      const char = token.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % 50000; // Limit to 50k vocab size
  });
}

/**
 * Count tokens in text
 * This is an approximation - actual token count depends on the model's tokenizer
 * @param {string} text - Text to count tokens for
 * @returns {number} - Token count estimate
 */
function countTokens(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  
  // For English and similar languages, a rough estimate is 4 characters per token
  // But we'll use a more accurate method with our simple tokenizer
  return encode(text).length;
}

/**
 * Truncate text to specified token count
 * @param {string} text - Text to truncate
 * @param {number} maxTokens - Maximum number of tokens
 * @returns {string} - Truncated text
 */
function truncateToTokenCount(text, maxTokens) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  // Tokenize the text first
  const tokens = text
    .replace(/([.,!?;:()])/g, ' $1 ') // Add spaces around punctuation
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .trim()
    .split(' ')
    .filter(token => token.length > 0);
  
  if (tokens.length <= maxTokens) {
    return text;
  }
  
  // Join the truncated tokens
  const truncatedText = tokens.slice(0, maxTokens).join(' ');
  
  // Add ellipsis to indicate truncation
  return truncatedText + '...';
}

/**
 * Split text into sentences
 * @param {string} text - Text to split
 * @returns {Array<string>} - Array of sentences
 */
function splitSentences(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  
  // Basic sentence splitting - can be improved for edge cases
  return text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0);
}

/**
 * Estimate token count per chunk of text for RAG
 * @param {string} text - Text chunk
 * @returns {number} - Estimated token count
 */
function estimateChunkTokens(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  
  // For most LLMs like Llama or Gemma, 1 token ≈ 4 characters for English
  // For other languages or complex text, this ratio may vary
  const charCount = text.length;
  return Math.ceil(charCount / 4);
}

module.exports = {
  encode,
  countTokens,
  truncateToTokenCount,
  splitSentences,
  estimateChunkTokens
};