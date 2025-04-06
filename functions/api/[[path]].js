/**
 * Cloudflare Worker entry point for handling API requests.
 * Intercepts requests made to /api/*
 *
 * Environment variables expected:
 * - OPENAI_API_KEY: Your OpenAI-compatible API key (Secret).
 * - API_ENDPOINT: The BASE URL for the LLM API endpoint (e.g., "https://api.openai.com/v1").
 * - SYSTEM_PROMPT: The system prompt for the LLM.
 * - LLM_MODEL: The model name to use (e.g., "gpt-4", "gpt-3.5-turbo").
 * - KV_NAMESPACE: Binding to the Cloudflare KV namespace (for auth codes & usage).
 */

// --- onRequest function (V8 version with routing logs) ---
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Log received path and method for debugging routing
  if (url.pathname.startsWith('/api/')) {
    console.log(`[onRequest V8] Received request: Method=${request.method}, Pathname=${url.pathname}`);
  }

  // Only respond to requests starting with /api/
  if (!url.pathname.startsWith('/api/')) {
    return new Response('Not Found', { status: 404 });
  }

  // Handle CORS preflight requests first
  if (request.method === 'OPTIONS') {
    return handleOptions();
  }

  let response; // Variable to hold the eventual response object

  try {
    // --- Request Routing ---
    if (url.pathname === '/api/login' && request.method === 'POST') {
      console.log("[onRequest V8] Routing to handleLoginRequest...");
      response = await handleLoginRequest(request, env);
    } else if (url.pathname === '/api/chat' && request.method === 'POST') {
      console.log("[onRequest V8] Routing to handleChatRequest...");
      response = await handleChatRequest(request, env);
      // Log the type and status of the returned value from the handler
      console.log("[onRequest V8] handleChatRequest returned:", response instanceof Response ? `Response (status: ${response.status})` : response);
    } else {
      // Route not found or method not allowed
      console.log(`[onRequest V8] No matching route found for ${request.method} ${url.pathname}. Returning 404.`);
      response = new Response(JSON.stringify({ error: 'API route not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Ensure we always have a Response object after the handler call
    if (!(response instanceof Response)) {
        console.error("[onRequest V8] Handler did not return a valid Response object. Assigning 500.");
        response = new Response(JSON.stringify({ error: 'Internal Server Error: Invalid handler response' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

  } catch (error) {
    // Catch unexpected errors
    console.error('[onRequest V8] Error during request handling or handler execution:', error);
    response = new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- Add CORS Headers to the final response ---
  const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  const responseHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
      responseHeaders.set(key, value);
  });

  // Return the final response
  return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
  });
}

// --- handleOptions function (Unchanged) ---
/**
 * Handles CORS preflight requests (OPTIONS).
 */
function handleOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
        },
    });
}

// --- handleLoginRequest function (Unchanged V4 - Uses KV) ---
/**
 * Handles the /api/login POST request using KV validation.
 * @param {Request} request
 * @param {object} env - Contains KV_NAMESPACE binding
 * @returns {Promise<Response>}
 */
async function handleLoginRequest(request, env) {
  try {
    // Validate request
    if (!request.headers.get('content-type')?.includes('application/json')) {
       return new Response(JSON.stringify({ error: 'Invalid request body type. Expected JSON.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    let body;
    try { body = await request.json(); } catch (e) { return new Response(JSON.stringify({ error: 'Invalid JSON format in request body.'}), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
    const providedCode = body.code;
    if (!providedCode) {
       return new Response(JSON.stringify({ error: 'Login code is required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // --- KV Validation Logic ---
    if (!env.KV_NAMESPACE) {
        console.error("[handleLoginRequest] KV_NAMESPACE binding is not configured in environment.");
        return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not bound.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    console.log(`[handleLoginRequest] Checking KV for login code: ${providedCode}`);
    const kvValue = await env.KV_NAMESPACE.get(providedCode);
    console.log(`[handleLoginRequest] KV lookup for ${providedCode} returned: ${kvValue === null ? 'null (Not Found)' : 'Found'}`);

    if (kvValue !== null) { // Key exists
      console.log(`[handleLoginRequest] Successful login attempt with valid KV code: ${providedCode}`);
      return new Response(JSON.stringify({ success: true, message: 'Login successful.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } else { // Key does not exist
      console.warn(`[handleLoginRequest] Failed login attempt with non-existent KV code: ${providedCode}`);
      return new Response(JSON.stringify({ success: false, error: 'Invalid login code.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    // --- End of KV Validation ---

  } catch (error) {
    console.error('[handleLoginRequest] Unexpected error caught:', error);
    return new Response(JSON.stringify({ error: 'Failed to process login request.', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}


// --- handleChatRequest function (V10 - Log raw response on JSON error) ---
/**
 * Handles the /api/chat POST request. Includes logging raw response text on JSON parse failure.
 * @param {Request} request
 * @param {object} env - Environment object
 * @returns {Promise<Response>}
 */
async function handleChatRequest(request, env) {
  console.log("[handleChatRequest V10] Function started.");
  try {
    // --- Input Validation ---
    console.log("[handleChatRequest V10] Validating input...");
    if (!request.headers.get('content-type')?.includes('application/json')) {
        console.error("[handleChatRequest V10] Invalid content-type.");
        console.log("[handleChatRequest V10] Returning 400 Bad Request (Content-Type).");
        return new Response(JSON.stringify({ error: 'Invalid request body type. Expected JSON.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    let body;
    try {
        body = await request.json();
    } catch (jsonError) {
        console.error('[handleChatRequest V10] Failed to parse request JSON body:', jsonError);
        console.log("[handleChatRequest V10] Returning 400 Bad Request (Request JSON Parse Error).");
        return new Response(JSON.stringify({ error: 'Invalid JSON format in request body.', details: jsonError.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userMessage = body.message;
    const loginCode = body.code;
    if (!userMessage || !loginCode) {
        console.error("[handleChatRequest V10] Missing message or login code in request body.");
        console.log("[handleChatRequest V10] Returning 400 Bad Request (Missing fields).");
        return new Response(JSON.stringify({ error: 'Message and login code are required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    
    // Clean user message: remove HTML tags and specific patterns
    let cleanedUserMessage = userMessage;
    try {
        // Remove HTML tags
        cleanedUserMessage = userMessage.replace(/<[^>]*>/g, '');

        // Remove name="..." content="..." patterns (case-insensitive for name/content)
        cleanedUserMessage = cleanedUserMessage.replace(/name=["'][^"']*["']\s*content=["'][^"']*["']/gi, '');

        // Remove excessive newlines (more than 2 consecutive)
        cleanedUserMessage = cleanedUserMessage.replace(/\n{3,}/g, '\n\n').trim();

        console.log(`[handleChatRequest V10] Cleaned user message. Original length: ${userMessage.length}, New length: ${cleanedUserMessage.length}`);

        // If cleaning resulted in a very short message but the original was longer, revert.
        if (cleanedUserMessage.length < 5 && userMessage.length > cleanedUserMessage.length) {
            console.log("[handleChatRequest V10] Cleaned message too short, reverting to original.");
            cleanedUserMessage = userMessage.trim(); // Use trimmed original
        }
    } catch (cleanError) {
        console.error('[handleChatRequest V10] Error while cleaning user message:', cleanError);
        // Fallback to the original message if cleaning fails
        cleanedUserMessage = userMessage.trim();
    }
    
    console.log("[handleChatRequest V10] Input validation passed.");

    // --- Re-validate Login Code using KV ---
    console.log(`[handleChatRequest V10] Checking KV for chat request with code: ${loginCode}`);
    if (!env.KV_NAMESPACE) {
        console.error("[handleChatRequest V10] KV_NAMESPACE binding is not configured.");
        console.log("[handleChatRequest V10] Returning 500 Internal Server Error (KV binding).");
        return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not bound.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    const kvValue = await env.KV_NAMESPACE.get(loginCode);
    console.log(`[handleChatRequest V10] KV lookup for ${loginCode} returned: ${kvValue === null ? 'null (Not Found)' : 'Found'}`);
    if (kvValue === null) {
        console.warn(`[handleChatRequest V10] Invalid/non-existent KV code during chat: ${loginCode}`);
        console.log("[handleChatRequest V10] Returning 401 Unauthorized (KV lookup failed).");
        return new Response(JSON.stringify({ error: 'Invalid or expired login code.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    console.log("[handleChatRequest V10] KV validation passed.");

    // --- Get Configuration ---
    console.log("[handleChatRequest V10] Getting configuration from env...");
    const apiKey = env.OPENAI_API_KEY;
    const apiBaseUrl = env.API_ENDPOINT || "https://api.openai.com/v1";
    const systemPrompt = env.SYSTEM_PROMPT || "You are a helpful assistant.";
    const modelName = env.LLM_MODEL || "gpt-3.5-turbo";
    console.log(`[handleChatRequest V10] Using Base URL: ${apiBaseUrl}, Model: ${modelName}`);
    if (!apiKey) {
        console.error("[handleChatRequest V10] OPENAI_API_KEY environment variable not set.");
        console.log("[handleChatRequest V10] Returning 500 Internal Server Error (API Key missing).");
        return new Response(JSON.stringify({ error: 'Server configuration error: Missing API Key.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    console.log("[handleChatRequest V10] Configuration loaded (API Key found).");

    // --- Construct Full URL ---
    let fullApiUrl;
    try {
        fullApiUrl = new URL("/chat/completions", apiBaseUrl).toString();
    } catch (urlError) {
        console.error(`[handleChatRequest V10] Invalid API_ENDPOINT format: ${apiBaseUrl}`, urlError);
        console.log("[handleChatRequest V10] Returning 500 Internal Server Error (Invalid API Endpoint URL).");
        return new Response(JSON.stringify({ error: 'Server configuration error: Invalid API Endpoint URL format.', details: urlError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    console.log(`[handleChatRequest V10] Constructed Full API URL: ${fullApiUrl}`);

    // --- Prepare Request & Call LLM API ---
    const messages = [ 
        { role: "system", content: systemPrompt }, 
        { role: "user", content: cleanedUserMessage } // Use the cleaned message
    ];
    const llmRequestPayload = { model: modelName, messages: messages };
    console.log(`[handleChatRequest V10] Calling LLM API at ${fullApiUrl}...`);
    const llmResponse = await fetch(fullApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(llmRequestPayload),
    });
    console.log(`[handleChatRequest V10] fetch completed. LLM API responded with status: ${llmResponse.status}, ok: ${llmResponse.ok}`);

    // --- Process LLM Response ---
    if (!llmResponse.ok) { // Handle non-2xx responses
        console.log("[handleChatRequest V10] Processing !llmResponse.ok block...");
        let errorText = `LLM API returned status ${llmResponse.status}`;
        try {
             const errorBody = await llmResponse.text(); // Read body as text
             console.error(`[handleChatRequest V10] LLM API request failed body: ${errorBody}`);
             
             // 添加更详细的错误日志
             console.error(`[handleChatRequest V10] Full request details: URL=${fullApiUrl}, Model=${modelName}`);
             
             // 尝试解析错误响应为JSON（如果可能）
             try {
                 const errorJson = JSON.parse(errorBody);
                 console.error(`[handleChatRequest V10] Parsed error response:`, errorJson);
                 // 如果是OpenAI格式的错误，提取更有用的信息
                 if (errorJson.error) {
                     errorText = `${errorJson.error.message || errorJson.error.type || errorText} (Code: ${errorJson.error.code || 'unknown'})`;
                 }
             } catch (e) {
                 // 如果不是JSON格式，使用原始文本
                 errorText = errorBody || errorText;
             }
        } catch (e) { 
            console.error("[handleChatRequest V10] Failed to read LLM error response body:", e); 
        }
        console.log(`[handleChatRequest V10] Returning ${llmResponse.status} (LLM API Error).`);
        return new Response(JSON.stringify({ 
            error: 'Failed to get response from AI service.', 
            details: errorText,
            status: llmResponse.status
        }), { status: llmResponse.status, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Process OK response (2xx) ---
    console.log("[handleChatRequest V10] Processing OK response block...");
    let llmResult;
    // Clone response before attempting JSON parse, in case parsing fails and we need the raw text
    const responseClone = llmResponse.clone();
    try {
        console.log("[handleChatRequest V10] Parsing LLM JSON response...");
        llmResult = await llmResponse.json(); // Try parsing original response as JSON
        console.log("[handleChatRequest V10] LLM JSON response parsed successfully.");
    } catch (jsonError) {
        console.error('[handleChatRequest V10] Failed to parse LLM JSON response:', jsonError);
        // Log raw text from the clone if JSON parsing fails
        try {
            const rawText = await responseClone.text(); // Read the body as text from the clone
            console.error('[handleChatRequest V10] Raw response text that failed JSON parsing:', rawText); // Log the raw text
            
            // 尝试手动解析响应内容
            if (rawText && rawText.trim()) {
                console.log("[handleChatRequest V10] Attempting manual response extraction...");
                
                // 检查是否包含常见的JSON格式错误
                let cleanedText = rawText;
                // 尝试修复一些常见的JSON格式问题
                try {
                    // 如果响应以HTML或其他非JSON格式开始，尝试查找JSON部分
                    const jsonStartIndex = rawText.indexOf('{');
                    const jsonEndIndex = rawText.lastIndexOf('}');
                    
                    if (jsonStartIndex >= 0 && jsonEndIndex > jsonStartIndex) {
                        cleanedText = rawText.substring(jsonStartIndex, jsonEndIndex + 1);
                        console.log("[handleChatRequest V10] Extracted potential JSON content:", cleanedText);
                        
                        // 尝试解析提取的JSON
                        const extractedJson = JSON.parse(cleanedText);
                        llmResult = extractedJson;
                        console.log("[handleChatRequest V10] Successfully parsed extracted JSON content");
                    } else {
                        // 如果找不到JSON结构，尝试将整个响应作为AI回复
                        console.log("[handleChatRequest V10] No JSON structure found, using raw text as reply");
                        return new Response(JSON.stringify({ 
                            reply: rawText.trim(),
                            warning: "Response was not in expected JSON format"
                        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                    }
                } catch (extractError) {
                    console.error("[handleChatRequest V10] Failed to extract or parse JSON from raw text:", extractError);
                    // 继续执行到原始错误处理
                }
            }
        } catch (textError) {
            console.error('[handleChatRequest V10] Failed to read raw response text after JSON parse failure:', textError);
        }
        
        // 如果所有尝试都失败，返回原始错误
        if (!llmResult) {
            console.log("[handleChatRequest V10] Returning 500 Internal Server Error (LLM JSON Parse Error).");
            return new Response(JSON.stringify({ 
                error: 'Failed to parse AI response.', 
                details: jsonError.message,
                suggestion: "Check Cloudflare logs for raw response details"
            }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
    }

    // --- Extract reply (only if JSON parsing succeeded) ---
    let aiReply;
    try {
        aiReply = llmResult.choices?.[0]?.message?.content?.trim();
        if (!aiReply) {
            // 尝试其他可能的响应格式
            aiReply = llmResult.response || llmResult.output || llmResult.text || llmResult.content;
            
            if (!aiReply && typeof llmResult === 'string') {
                // 如果llmResult本身是字符串，直接使用它
                aiReply = llmResult.trim();
            }
        }
    } catch (extractError) {
        console.error('[handleChatRequest V10] Error extracting AI reply from result:', extractError);
    }
    
    if (!aiReply) {
        console.error('[handleChatRequest V10] Could not extract AI reply from parsed LLM response:', JSON.stringify(llmResult));
        console.log("[handleChatRequest V10] Returning 500 Internal Server Error (Parse Error - No Reply Content).");
        return new Response(JSON.stringify({ 
            error: 'Failed to parse AI response (content missing).', 
            responseStructure: Object.keys(llmResult).join(', ')
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    console.log(`[handleChatRequest V10] Successfully extracted AI reply.`);

    // --- TODO: Token Tracking ---

    // --- Return AI Reply ---
    console.log("[handleChatRequest V10] Returning 200 OK with AI reply.");
    return new Response(JSON.stringify({ reply: aiReply }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[handleChatRequest V10] Unexpected error caught in try-catch block:', error);
    console.log("[handleChatRequest V10] Returning 500 Internal Server Error (Caught Exception).");
    return new Response(JSON.stringify({ error: 'Failed to process chat request.', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// --- TODO: Add updateTokenCount function later for KV ---