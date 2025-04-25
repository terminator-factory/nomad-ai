// server/setup.js
// Script for RAG system setup with cross-platform compatibility

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Define necessary directories with platform-agnostic paths
const BASE_DIR = path.join(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const CONTENT_DIR = path.join(DATA_DIR, 'content');
const METADATA_DIR = path.join(DATA_DIR, 'metadata');
const UPLOADS_DIR = path.join(BASE_DIR, 'uploads');

// All directories to create
const directoriesToCreate = [
  DATA_DIR,
  CONTENT_DIR,
  METADATA_DIR,
  UPLOADS_DIR
];

// Create directories with proper permissions
directoriesToCreate.forEach(dir => {
  if (!fs.existsSync(dir)) {
    console.log(`Creating directory: ${dir}`);
    try {
      // {recursive: true} works on both Windows and Linux
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Directory created successfully: ${dir}`);
      
      // Set permissions on Linux/Mac only
      if (process.platform !== 'win32') {
        fs.chmodSync(dir, 0o755);
      }
    } catch (error) {
      console.error(`Error creating directory ${dir}:`, error);
    }
  } else {
    console.log(`Directory already exists: ${dir}`);
  }
});

// Create empty JSON files for storage if they don't exist
const filesToCreate = [
  { path: path.join(DATA_DIR, 'vector_store.json'), content: '[]' },
  { path: path.join(DATA_DIR, 'vector_index.json'), content: '{}' },
  { path: path.join(DATA_DIR, 'hash_index.json'), content: '{}' },
  { path: path.join(DATA_DIR, 'embedding_cache.json'), content: '{}' }
];

filesToCreate.forEach(file => {
  if (!fs.existsSync(file.path)) {
    console.log(`Creating file: ${file.path}`);
    try {
      fs.writeFileSync(file.path, file.content, 'utf8');
      console.log(`File created successfully: ${file.path}`);
    } catch (error) {
      console.error(`Error creating file ${file.path}:`, error);
    }
  } else {
    console.log(`File already exists: ${file.path}`);
  }
});

// Create .env file with default settings if it doesn't exist
const envFilePath = path.join(BASE_DIR, '..', '.env');
if (!fs.existsSync(envFilePath)) {
  const envContent = `
# LLM API URL (Ollama API endpoint)
LLM_API_URL=http://localhost:11434/api/generate

# Socket.IO URL
REACT_APP_SOCKET_URL=http://localhost:3001

# Server port
PORT=3001
`;
  
  console.log(`Creating .env file with default settings: ${envFilePath}`);
  try {
    fs.writeFileSync(envFilePath, envContent, 'utf8');
    console.log('.env file created successfully');
  } catch (error) {
    console.error('Error creating .env file:', error);
  }
} else {
  console.log(`.env file already exists: ${envFilePath}`);
}

console.log('\n=== RAG System Setup Complete ===');
console.log('You can now start the application:');
console.log('npm run dev');

// Check for Ollama installation
const checkOllama = () => {
  const command = process.platform === 'win32' ? 'where ollama' : 'which ollama';
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.log('\nOllama is not found in your PATH.');
      console.log('To use RAG capabilities, you need to install Ollama:');
      
      if (process.platform === 'win32') {
        console.log('- Download from: https://ollama.com/download/windows');
      } else if (process.platform === 'darwin') {
        console.log('- macOS: curl -fsSL https://ollama.com/install.sh | sh');
      } else {
        console.log('- Linux: curl -fsSL https://ollama.com/install.sh | sh');
      }
      
      console.log('\nAfter installation, start Ollama with:');
      console.log('ollama serve');
      console.log('\nThen pull a model (like Gemma or Llama):');
      console.log('ollama pull gemma3:4b');
    } else {
      console.log(`\nOllama found at: ${stdout.trim()}`);
      console.log('Make sure Ollama is running with: ollama serve');
      
      // Check if Ollama is running
      const isWindowsPS = process.platform === 'win32';
      const checkRunningCmd = isWindowsPS
        ? 'powershell -command "Get-Process ollama -ErrorAction SilentlyContinue"'
        : 'ps aux | grep ollama | grep -v grep';
      
      exec(checkRunningCmd, (runError, runStdout) => {
        if (!runStdout || runStdout.trim() === '') {
          console.log('\nOllama does not appear to be running.');
          console.log('Start it with: ollama serve');
        } else {
          console.log('\nOllama appears to be running.');
          
          // Check available models
          exec('ollama list', (listError, listStdout) => {
            if (listError) {
              console.error('Error checking Ollama models:', listError);
            } else {
              console.log('\nAvailable models:');
              console.log(listStdout.trim());
              
              if (!listStdout.includes('gemma') && !listStdout.includes('llama')) {
                console.log('\nYou may want to pull a recommended model:');
                console.log('ollama pull gemma3:4b  # Recommended for good performance');
              }
            }
          });
        }
      });
    }
  });
};

checkOllama();