import { useState, useEffect, useRef } from 'react';
import ChatMessage from '../Component/ChatMessage';
import { FaPlus, FaPaperPlane, FaBars, FaMoon, FaSun, FaEnvelope, FaCalendarAlt, FaFilePdf, FaImage } from 'react-icons/fa';
import { toast } from 'react-toastify';

function Home() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hi there! 😊 How can I help you today?', timestamp: new Date().toISOString() },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [selectedFile, setSelectedFile] = useState(null);
  const dropdownRef = useRef(null);
  const wsRef = useRef(null);
  const chatContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const clientId = '123';
  const lastChunkTimeRef = useRef(null);
  const timeoutRef = useRef(null);

  // Load conversation history from local storage on mount
  useEffect(() => {
    const storedHistory = JSON.parse(localStorage.getItem('conversationHistory') || '[]');
    setHistory(storedHistory);
  }, []);

  // Initialize new conversation on mount
  useEffect(() => {
    handleNewConversation();
  }, []);

  // Initialize WebSocket connection
  useEffect(() => {
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectInterval = 3000;
    let accumulatedResponse = '';
    let isDateQuery = false;

    const connectWebSocket = () => {
      const ws = new WebSocket(`ws://localhost:8000/ws/${clientId}`);
      wsRef.current = ws;

      // Clean response
      const cleanResponse = (text) => {
        return text
          .replace(/TOOL_CALL::.*?}/g, '')
          .replace(/TOOL_CALL/g, '')
          .replace(/(\*\*|`{1,3}|\n{2,})/g, '')
          .replace(/Let me (fetch|check|help|explain).*?\./gi, '')
          .replace(/Let me know if.*$/gi, '')
          .replace(/Here's a simple.*?:/gi, '')
          .replace(/###\s*How to run.*?(?=\n|$)/gis, '')
          .replace(/(\d+\.\s*.*?)(?=\n|$)/g, '')
          .trim();
      };

      // Format response
      const formatResponse = (text) => {
        if (isDateQuery) {
          const dateMatch = text.match(/(\w+ \d{1,2}, \d{4})|(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            const date = new Date(dateMatch[0]);
            if (!isNaN(date)) {
              return `Today's date is ${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
            }
          }
        }

        const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
        let formatted = text;
        let codeBlocks = [];
        let match;
        while ((match = codeBlockRegex.exec(text)) !== null) {
          const lang = match[1] || 'text';
          const code = match[2].trim();
          const codeId = `code-${Math.random().toString(36).substr(2, 9)}`;
          const html = `
            <div class="code-block">
              <div class="code-header">
                <span class="code-lang">${lang}</span>
                <button class="code-btn copy-btn" data-code-id="${codeId}">Copy</button>
                <button class="code-btn edit-btn" data-code-id="${codeId}">Edit</button>
              </div>
              <pre><code class="language-${lang}" id="${codeId}">${code}</code></pre>
            </div>
          `;
          codeBlocks.push({ original: match[0], html });
        }

        let lastIndex = 0;
        let result = '';
        codeBlocks.forEach(({ original, html }, index) => {
          const startIndex = text.indexOf(original, lastIndex);
          const beforeText = cleanResponse(text.slice(lastIndex, startIndex)).trim();
          if (beforeText) result += `${beforeText}<br><br>`;
          result += html;
          lastIndex = startIndex + original.length;
          if (index === codeBlocks.length - 1) {
            const afterText = cleanResponse(text.slice(lastIndex)).trim();
            if (afterText) result += `<br><br>${afterText}`;
          }
        });

        if (!codeBlocks.length) {
          return cleanResponse(text);
        }
        return result;
      };

      // Function to display accumulated response
      const displayResponse = () => {
        if (!accumulatedResponse) return;

        const formatted = formatResponse(accumulatedResponse);
        setMessages((prevMessages) => {
          const lastMessageIndex = prevMessages.length - 1;
          const lastMessage = prevMessages[lastMessageIndex];
          console.log('Displaying response for last message:', lastMessage);
          if (lastMessage && lastMessage.role === 'assistant') {
            return [
              ...prevMessages.slice(0, lastMessageIndex),
              {
                ...lastMessage,
                content: formatted,
                isStreaming: false,
              },
            ];
          }
          return [
            ...prevMessages,
            {
              role: 'assistant',
              content: formatted,
              timestamp: new Date().toISOString(),
              isStreaming: false,
            },
          ];
        });

        accumulatedResponse = '';
        isDateQuery = false;
        lastChunkTimeRef.current = null;
        console.log('Response displayed');
      };

      ws.onopen = () => {
        console.log(`Connected to ws://localhost:8000/ws/${clientId}`);
        reconnectAttempts = 0;
        accumulatedResponse = '';
        isDateQuery = false;
        lastChunkTimeRef.current = null;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received WebSocket message:', data);

          if (data.type === 'ai_chunk') {
            accumulatedResponse += data.payload;
            isDateQuery = isDateQuery || data.payload.toLowerCase().includes('date') || data.payload.match(/(\w+ \d{1,2}, \d{4})|(\d{4}-\d{2}-\d{2})/);
            console.log('Accumulated response:', accumulatedResponse);

            // Update last chunk time
            lastChunkTimeRef.current = Date.now();

            // Clear any existing timeout
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
            }

            // Set a timeout to display the response if no more chunks arrive
            timeoutRef.current = setTimeout(() => {
              if (lastChunkTimeRef.current && (Date.now() - lastChunkTimeRef.current) >= 1000) {
                displayResponse();
              }
            }, 1000);
          } else if (data.type === 'error') {
            setMessages((prev) => [
              ...prev,
              {
                role: 'assistant',
                content: `Error: ${data.payload}`,
                timestamp: new Date().toISOString(),
                isStreaming: false,
              },
            ]);
          } else if (data.type === 'model_connected') {
            console.log(data.payload);
          } else if (data.type === 'stream_end') {
            // Clear timeout since we received stream_end
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
            }

            displayResponse();
            console.log('Stream finalized');
          }
        } catch (error) {
          console.error('WebSocket message error:', error);
        } finally {
          console.log('Processed WebSocket message');
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error details:', error);
        setMessages((prev) => [
          ...prev,
          // {
          //   role: 'assistant',
          //   content: `Failed to connect to the server. Error: ${error.message || 'Unknown error'}`,
          //   timestamp: new Date().toISOString(),
          //   isStreaming: false,
          // },
        ]);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        if (reconnectAttempts < maxReconnectAttempts) {
          console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${maxReconnectAttempts})...`);
          setTimeout(() => {
            reconnectAttempts++;
            connectWebSocket();
          }, reconnectInterval);
        } else {
          console.error('Max reconnect attempts reached. Please refresh the page.');
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: 'Unable to reconnect to the server. Please refresh the page.',
              timestamp: new Date().toISOString(),
              isStreaming: false,
            },
          ]);
        }
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [clientId]);

  // Handle clicks outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle Copy and Edit button clicks
  useEffect(() => {
    const handleButtonClick = (event) => {
      if (event.target.classList.contains('copy-btn')) {
        const codeId = event.target.getAttribute('data-code-id');
        const codeElement = document.getElementById(codeId);
        if (codeElement) {
          navigator.clipboard.writeText(codeElement.textContent);
          alert('Code copied to clipboard!');
        }
      } else if (event.target.classList.contains('edit-btn')) {
        const codeId = event.target.getAttribute('data-code-id');
        const codeElement = document.getElementById(codeId);
        if (codeElement) {
          setInput(codeElement.textContent);
        }
      }
    };
    document.addEventListener('click', handleButtonClick);
    return () => {
      document.removeEventListener('click', handleButtonClick);
    };
  }, []);

  // Handle file selection
  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
      setSelectedFile(file);
      setInput('Summarize this PDF');
      if (wsRef.current && file) {
        const reader = new FileReader();
        reader.onload = () => {
          wsRef.current.send(
            JSON.stringify({
              type: 'upload_pdf',
              payload: {
                fileName: file.name,
                fileData: reader.result,
              },
            })
          );
        };
        reader.readAsDataURL(file);
      }
    } else {
      alert('Please select a valid PDF file.');
    }
  };

  const handleSend = () => {
    if (!input.trim() || !wsRef.current) return;

    const userMessage = { role: 'user', content: input, timestamp: new Date().toISOString() };
    const assistantMessage = { role: 'assistant', content: '', timestamp: new Date().toISOString(), isStreaming: true };
    const newMessages = [...messages, userMessage, assistantMessage];
    setMessages(newMessages);

    wsRef.current.send(
      JSON.stringify({
        type: 'user_message',
        payload: input,
        model: 'openai',
      })
    );

    setInput('');
    setSelectedFile(null);

    let updatedHistory;
    if (currentConversationId) {
      updatedHistory = history.map((conv) =>
        conv.id === currentConversationId ? { ...conv, messages: newMessages } : conv
      );
    } else {
      const newConversation = {
        id: Date.now().toString(),
        messages: newMessages,
        snippet: input.slice(0, 30) + (input.length > 30 ? '...' : ''),
        timestamp: new Date().toISOString(),
      };
      updatedHistory = [...history, newConversation];
      setCurrentConversationId(newConversation.id);
    }
    setHistory(updatedHistory);
    localStorage.setItem('conversationHistory', JSON.stringify(updatedHistory));
  };

  const handleLoadConversation = (conversationId) => {
    const conversation = history.find((conv) => conv.id === conversationId);
    if (conversation) {
      setMessages(conversation.messages);
      setCurrentConversationId(conversationId);
      if (wsRef.current) {
        wsRef.current.send(
          JSON.stringify({
            type: 'load_chat',
            payload: { conversationId },
          })
        );
      }
    }
    setIsSidebarOpen(false);
  };

  const handleNewConversation = () => {
    setMessages([
      { role: 'assistant', content: 'Hi there! 😊 How can I help you today?', timestamp: new Date().toISOString() },
    ]);
    setCurrentConversationId(null);
    setInput('');
    setSelectedFile(null);
    setIsSidebarOpen(false);
    if (wsRef.current) {
      wsRef.current.send(
        JSON.stringify({
          type: 'start_chat',
          payload: {},
        })
      );
    }
  };

  const handleOptionClick = (option) => {
    console.log(`${option} clicked`);
    switch (option) {
      case 'Send a email':
        setInput('Write an email for me');
        break;
      case 'Set Calender':
        setInput('Set a calendar event');
        break;
      case 'Summarize pdf':
        setInput('Summarize this PDF');
        if (fileInputRef.current) {
          fileInputRef.current.click();
        }
        break;
      case 'Create image':
        setInput('Generate an image');
        break;
      default:
        setInput('');
    }
  };
const handleDropdownOption = (option) => {
  toast(`${option} clicked`);
  setIsDropdownOpen(false);
};


  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const userQueries = history.map((conv) => ({
    id: conv.id,
    query: conv.messages.find((msg) => msg.role === 'user')?.content || 'Untitled',
    timestamp: conv.timestamp,
  }));

  return (
    <div className={`min-h-screen w-full flex flex-col overflow-hidden ${theme === 'dark' ? 'bg-black' : 'bg-gray-100'}`}>
      <div className="fixed top-4 right-4 z-30">
        <button
          onClick={toggleTheme}
          className={`p-2 ${theme === 'dark' ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800'} rounded-full transition-colors duration-200`}
        >
          {theme === 'dark' ? <FaSun className="w-5 h-5" /> : <FaMoon className="w-5 h-5" />}
        </button>
      </div>

      <div
        className={`fixed top-0 left-0 w-full h-16 flex items-center space-x-3 px-4 z-20 ${theme === 'dark' ? 'bg-black' : 'bg-white'} ${
          isSidebarOpen ? 'ml-72' : 'ml-0'
        } transition-all duration-300 ease-in-out`}
      >
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={`p-2 ${theme === 'dark' ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800'} rounded-full transition-colors duration-200`}
          title="History"
        >
          <FaBars className="w-5 h-5" />
        </button>
        <button
          onClick={handleNewConversation}
          className={`flex items-center space-x-1 px-3 py-2 ${theme === 'dark' ? 'bg-gray-800 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-full transition-colors duration-200`}
          title="New Chat"
        >
          <FaPlus className="w-4 h-4" />
          <span className="text-sm font-medium">New Chat</span>
        </button>
        <h1 className={`text-xl font-semibold ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
          JOI
        </h1>
      </div>

      <div className="flex flex-1 pt-16">
        <div
          className={`fixed inset-y-0 left-0 w-72 ${theme === 'dark' ? 'bg-black' : 'bg-white'} transform ${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } transition-transform duration-300 ease-in-out z-10 mt-16`}
        >
          <div className="h-full flex flex-col">
            <div className="p-4">
              <h2 className={`text-base font-bold ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>JOI</h2>
              <h2 className={`text-sm font-semibold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>History</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-4 space-y-2">
              {userQueries.length === 0 ? (
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>No chat history yet.</p>
              ) : (
                userQueries.map((query) => (
                  <div
                    key={query.id}
                    onClick={() => handleLoadConversation(query.id)}
                    className={`p-3 ${theme === 'dark' ? 'bg-gray-800 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} rounded-lg cursor-pointer transition-colors duration-200`}
                  >
                    <p className={`text-sm truncate ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
                      {query.query}
                    </p>
                    <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                      {new Date(query.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div
          className={`flex-1 flex flex-col transition-all duration-300 ease-in-out ${
            isSidebarOpen ? 'ml-72' : 'ml-0'
          }`}
        >
          <div
            ref={chatContainerRef}
            className={`flex-1 px-4 py-6 overflow-y-auto ${theme === 'dark' ? 'bg-black' : 'bg-gray-100'} flex flex-col max-h-[calc(100vh-16rem)]`}
          >
            {messages.length === 1 && messages[0].content === 'Hi there! 😊 How can I help you today?' ? (
              <div className="flex-1 flex items-center justify-center">
                <p className={`text-lg font-medium ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
                  Hi there! 😊 How can I help you today?
                </p>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto w-full">
                {messages.map((msg, index) => (
                  <div
                    key={index}
                    className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}
                  >
                    <div
                      className={`inline-block p-3 rounded-lg ${theme === 'dark' ? 'bg-gray-800 text-gray-200' : 'bg-gray-200 text-gray-800'} max-w-md`}
                    >
                      <div className="text-left" dir="ltr" dangerouslySetInnerHTML={{ __html: msg.content }} />
                      <span className={`text-xs block mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                        {new Date(msg.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={`px-4 py-6 ${theme === 'dark' ? 'bg-black' : 'bg-white'}`}>
            <div className="max-w-3xl mx-auto">
              <div className="space-y-3">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className={`flex items-center ${theme === 'dark' ? 'bg-black' : 'bg-gray-200'} rounded-lg p-3`}>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    className={`flex-1 p-2 bg-transparent rounded-lg ${theme === 'dark' ? 'text-gray-200 placeholder-gray-400' : 'text-gray-800 placeholder-gray-500'} border-none focus:outline-none focus:ring-0`}
                    placeholder="Ask anything"
                  />
                  <button
                    onClick={handleSend}
                    className={`p-2 ${theme === 'dark' ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-lg transition-colors duration-200 ml-2`}
                  >
                    <FaPaperPlane className="w-5 h-5" />
                  </button>
                </div>
                {selectedFile && (
                  <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    Selected: {selectedFile.name}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="relative" ref={dropdownRef}>
                      <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className={`flex items-center justify-center w-9 h-9 ${theme === 'dark' ? 'bg-gray-800 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-full transition-colors duration-200`}
                      >
                        <FaPlus className="w-4 h-4" />
                      </button>
                      {isDropdownOpen && (
                        <div className={`absolute bottom-12 left-0 w-48 ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-200'} rounded-lg z-10`}>
                          <button
                            onClick={() => handleDropdownOption('Connect with Open AI')}
                            className={`w-full text-left px-3 py-2 ${theme === 'dark' ? 'text-gray-200 hover:bg-gray-600' : 'text-gray-800 hover:bg-gray-300'} rounded-t-lg transition-colors duration-200`}
                          >
                            Connect with Open AI
                          </button>
                          <button
                            onClick={() => handleDropdownOption('Connect with Gemini')}
                            className={`w-full text-left px-3 py-2 ${theme === 'dark' ? 'text-gray-200 hover:bg-gray-600' : 'text-gray-800 hover:bg-gray-300'} rounded-b-lg transition-colors duration-200`}
                          >
                            Connect with Gemini
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleOptionClick('Send a email')}
                      className={`flex items-center space-x-1 px-3 py-2 ${theme === 'dark' ? 'bg-gray-800 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-full transition-colors duration-200`}
                    >
                      <FaEnvelope className="w-4 h-4" />
                      <span className="text-sm font-medium">Send a email</span>
                    </button>
                    <button
                      onClick={() => handleOptionClick('Set Calender')}
                      className={`flex items-center space-x-1 px-3 py-2 ${theme === 'dark' ? 'bg-gray-800 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-full transition-colors duration-200`}
                    >
                      <FaCalendarAlt className="w-4 h-4" />
                      <span className="text-sm font-medium">Set Calender</span>
                    </button>
                    <button
                      onClick={() => handleOptionClick('Summarize pdf')}
                      className={`flex items-center space-x-1 px-3 py-2 ${theme === 'dark' ? 'bg-gray-800 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-full transition-colors duration-200`}
                    >
                      <FaFilePdf className="w-4 h-4" />
                      <span className="text-sm font-medium">Summarize pdf</span>
                    </button>
                    <button
                      onClick={() => handleOptionClick('Create image')}
                      className={`flex items-center space-x-1 px-3 py-2 ${theme === 'dark' ? 'bg-gray-800 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-full transition-colors duration-200`}
                    >
                      <FaImage className="w-4 h-4" />
                      <span className="text-sm font-medium">Create image</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;