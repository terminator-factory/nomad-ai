// tailwind.config.js
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'chat-bg': '#343541',
        'user-message': '#444654',
        'bot-message': '#343541',
        'input-bg': '#40414f',
        'button-primary': '#10a37f',
        'brand-green': '#1e8449', // Добавляем наш новый цвет
        'brand-dark-green': '#145A32'
      },
    },
  },
  plugins: [],
}