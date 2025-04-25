// server/src/services/tokenizer.js
// Simple tokenizer implementation

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
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return Math.abs(hash) % 50000; // Limit to 50k vocab size
    });
  }
  
  /**
   * Count tokens in text
   * @param {string} text - Text to count tokens for
   * @returns {number} - Token count
   */
  function countTokens(text) {
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
    
    const tokens = text
      .replace(/([.,!?;:()])/g, ' $1 ') // Add spaces around punctuation
      .replace(/\s+/g, ' ')             // Normalize whitespace
      .trim()
      .split(' ')
      .filter(token => token.length > 0);
    
    if (tokens.length <= maxTokens) {
      return text;
    }
    
    return tokens.slice(0, maxTokens).join(' ') + '...';
  }
  
  module.exports = {
    encode,
    countTokens,
    truncateToTokenCount
  };