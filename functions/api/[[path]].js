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
export async function onRequest(context) { /* ... same as V8/V9 ... */ }

// --- handleOptions function (Keep the previous version) ---
function handleOptions() { /* ... same as before ... */ }

// --- handleLoginRequest function (Keep the previous version) ---
async function handleLoginRequest(request, env) { /* ... same as before ... */ }


// --- UPDATED handleChatRequest function (V10 - Log raw response on JSON error) ---
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
    // ... (Input validation code remains the same) ...
    if (!request.headers.get('content-type')?.includes('application/json')) { /* ... return 400 ... */ }
    let body;
    try { body = await request.json(); } catch (jsonError) { /* ... return 400 ... */ }
    const userMessage = body.message;
    const loginCode = body.code;
    if (!userMessage || !loginCode) { /* ... return 400 ... */ }
    console.log("[handleChatRequest V10] Input validation passed.");

    // --- Re-validate Login Code using KV ---
    // ... (KV validation code remains the same) ...
    console.log(`[handleChatRequest V10] Checking KV for chat request with code: ${loginCode}`);
    if (!env.KV_NAMESPACE) { /* ... return 500 ... */ }
    const kvValue = await env.KV_NAMESPACE.get(loginCode);
    console.log(`[handleChatRequest V10] KV lookup for ${loginCode} returned: ${kvValue === null ? 'null (Not Found)' : 'Found'}`);
    if (kvValue === null) { /* ... return 401 ... */ }
    console.log("[handleChatRequest V10] KV validation passed.");

    // --- Get Configuration ---
    // ... (Configuration loading code remains the same) ...
    console.log("[handleChatRequest V10] Getting configuration from env...");
    const apiKey = env.OPENAI_API_KEY;
    const apiBaseUrl = env.API_ENDPOINT || "https://api.openai.com/v1";
    const systemPrompt = env.SYSTEM_PROMPT || "You are a helpful assistant.";
    const modelName = env.LLM_MODEL || "gpt-3.5-turbo";
    console.log(`[handleChatRequest V10] Using Base URL: ${apiBaseUrl}, Model: ${modelName}`);
    if (!apiKey) { /* ... return 500 ... */ }
    console.log("[handleChatRequest V10] Configuration loaded (API Key found).");

    // --- Construct Full URL ---
    let fullApiUrl;
    try { fullApiUrl = new URL("/chat/completions", apiBaseUrl).toString(); } catch (urlError) { /* ... return 500 ... */ }
    console.log(`[handleChatRequest V10] Constructed Full API URL: ${fullApiUrl}`);

    // --- Prepare Request & Call LLM API ---
    const messages = [ { role: "system", content: systemPrompt }, { role: "user", content: userMessage } ];
    const llmRequestPayload = { model: modelName, messages: messages };
    console.log(`[handleChatRequest V10] Calling LLM API at ${fullApiUrl}...`);
    const llmResponse = await fetch(fullApiUrl, { /* ... options ... */ });
    console.log(`[handleChatRequest V10] fetch completed. LLM API responded with status: ${llmResponse.status}, ok: ${llmResponse.ok}`);

    // --- Process LLM Response ---
    if (!llmResponse.ok) { // Handle non-2xx responses
        console.log("[handleChatRequest V10] Processing !llmResponse.ok block...");
        let errorText = `LLM API returned status ${llmResponse.status}`;
        try {
             const errorBody = await llmResponse.text(); // Read body as text
             console.error(`[handleChatRequest V10] LLM API request failed body: ${errorBody}`);
             errorText = errorBody || errorText;
        } catch (e) { console.error("[handleChatRequest V10] Failed to read LLM error response body:", e); }
        console.log(`[handleChatRequest V10] Returning ${llmResponse.status} (LLM API Error).`);
        return new Response(JSON.stringify({ error: 'Failed to get response from AI service.', details: errorText }), { status: llmResponse.status, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Process OK response (2xx) ---
    console.log("[handleChatRequest V10] Processing OK response block...");
    let llmResult;
    // *** NEW: Clone response before attempting JSON parse ***
    const responseClone = llmResponse.clone(); // Create a clone to allow reading body multiple times if needed
    try {
        console.log("[handleChatRequest V10] Parsing LLM JSON response...");
        llmResult = await llmResponse.json(); // Try parsing original response as JSON
        console.log("[handleChatRequest V10] LLM JSON response parsed successfully.");
    } catch (jsonError) {
        console.error('[handleChatRequest V10] Failed to parse LLM JSON response:', jsonError);
        // *** NEW: Log raw text from the clone if JSON fails ***
        try {
            const rawText = await responseClone.text(); // Read the body as text from the clone
            console.error('[handleChatRequest V10] Raw response text that failed JSON parsing:', rawText);
        } catch (textError) {
            console.error('[handleChatRequest V10] Failed to read raw response text after JSON parse failure:', textError);
        }
        // --- End new logging ---
        console.log("[handleChatRequest V10] Returning 500 Internal Server Error (LLM JSON Parse Error).");
        return new Response(JSON.stringify({ error: 'Failed to parse AI response.', details: jsonError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Extract reply (only if JSON parsing succeeded) ---
    const aiReply = llmResult.choices?.[0]?.message?.content?.trim();
    if (!aiReply) {
        console.error('[handleChatRequest V10] Could not extract AI reply from parsed LLM response:', JSON.stringify(llmResult));
        console.log("[handleChatRequest V10] Returning 500 Internal Server Error (Parse Error - No Reply Content).");
        return new Response(JSON.stringify({ error: 'Failed to parse AI response (content missing).' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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


// --- handleChatRequest function (V9 - Correct URL construction) ---
/**
 * Handles the /api/chat POST request using KV validation and calling LLM API.
 * Correctly constructs the full API URL.
 * @param {Request} request
 * @param {object} env - Environment object
 * @returns {Promise<Response>}
 */
async function handleChatRequest(request, env) {
  console.log("[handleChatRequest V9] Function started.");
  try {
    // --- Input Validation ---
    console.log("[handleChatRequest V9] Validating input...");
    if (!request.headers.get('content-type')?.includes('application/json')) {
        console.log("[handleChatRequest V9] Returning 400 Bad Request (Content-Type).");
        return new Response(JSON.stringify({ error: 'Invalid request body type. Expected JSON.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    let body;
    try {
        body = await request.json();
    } catch (jsonError) {
        console.error('[handleChatRequest V9] Failed to parse request JSON body:', jsonError);
        console.log("[handleChatRequest V9] Returning 400 Bad Request (Request JSON Parse Error).");
        return new Response(JSON.stringify({ error: 'Invalid JSON format in request body.', details: jsonError.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const userMessage = body.message;
    const loginCode = body.code;
    if (!userMessage || !loginCode) {
        console.error("[handleChatRequest V9] Missing message or login code in request body.");
        console.log("[handleChatRequest V9] Returning 400 Bad Request (Missing fields).");
        return new Response(JSON.stringify({ error: 'Message and login code are required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    console.log("[handleChatRequest V9] Input validation passed.");

    // --- Re-validate Login Code using KV ---
    console.log(`[handleChatRequest V9] Checking KV for chat request with code: ${loginCode}`);
    if (!env.KV_NAMESPACE) {
        console.error("[handleChatRequest V9] KV_NAMESPACE binding is not configured.");
        console.log("[handleChatRequest V9] Returning 500 Internal Server Error (KV binding).");
        return new Response(JSON.stringify({ error: 'Server configuration error: KV Namespace not bound.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    const kvValue = await env.KV_NAMESPACE.get(loginCode);
    console.log(`[handleChatRequest V9] KV lookup for ${loginCode} returned: ${kvValue === null ? 'null (Not Found)' : 'Found'}`);
    if (kvValue === null) {
        console.warn(`[handleChatRequest V9] Invalid/non-existent KV code during chat: ${loginCode}`);
        console.log("[handleChatRequest V9] Returning 401 Unauthorized (KV lookup failed).");
        return new Response(JSON.stringify({ error: 'Invalid or expired login code.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    console.log("[handleChatRequest V9] KV validation passed.");

    // --- Get Configuration ---
    console.log("[handleChatRequest V9] Getting configuration from env...");
    const apiKey = env.OPENAI_API_KEY;
    // Treat API_ENDPOINT as the base URL. Use OpenAI default *base* if not set.
    const apiBaseUrl = env.API_ENDPOINT || "https://api.openai.com/v1";
    const systemPrompt = env.SYSTEM_PROMPT || "You are a helpful assistant.";
    const modelName = env.LLM_MODEL || "gpt-3.5-turbo";
    console.log(`[handleChatRequest V9] Using Base URL: ${apiBaseUrl}, Model: ${modelName}`);

    if (!apiKey) {
        console.error("[handleChatRequest V9] OPENAI_API_KEY environment variable not set.");
        console.log("[handleChatRequest V9] Returning 500 Internal Server Error (API Key missing).");
        return new Response(JSON.stringify({ error: 'Server configuration error: Missing API Key.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    console.log("[handleChatRequest V9] Configuration loaded (API Key found).");

    // --- *** Construct the full URL correctly *** ---
    let fullApiUrl;
    try {
      // Use URL constructor to safely join base URL and path
      // Assumes the standard path is /chat/completions for OpenAI compatible APIs
      fullApiUrl = new URL("/chat/completions", apiBaseUrl).toString();
    } catch (urlError) {
      // This catches errors if apiBaseUrl is not a valid base URL format
      console.error(`[handleChatRequest V9] Invalid API_ENDPOINT format in environment variable: ${apiBaseUrl}`, urlError);
      console.log("[handleChatRequest V9] Returning 500 Internal Server Error (Invalid API Endpoint URL).");
      return new Response(JSON.stringify({ error: 'Server configuration error: Invalid API Endpoint URL format.', details: urlError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    console.log(`[handleChatRequest V9] Constructed Full API URL: ${fullApiUrl}`);
    // --- *** END URL Construction *** ---

    // --- Prepare Request & Call LLM API ---
    const messages = [ { role: "system", content: systemPrompt }, { role: "user", content: userMessage } ];
    const llmRequestPayload = { model: modelName, messages: messages };
    console.log(`[handleChatRequest V9] Calling LLM API at ${fullApiUrl}...`); // Use fullApiUrl
    const llmResponse = await fetch(fullApiUrl, { // Use fullApiUrl
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(llmRequestPayload),
    });
    console.log(`[handleChatRequest V9] fetch completed. LLM API responded with status: ${llmResponse.status}, ok: ${llmResponse.ok}`);

    // --- Process LLM Response ---
    if (!llmResponse.ok) { // Checks if status is 200-299
        console.log("[handleChatRequest V9] Processing !llmResponse.ok block...");
        let errorText = `LLM API returned status ${llmResponse.status}`;
        try {
             const errorBody = await llmResponse.text();
             console.error(`[handleChatRequest V9] LLM API request failed body: ${errorBody}`);
             errorText = errorBody || errorText; // Use body if available for details
        } catch (e) { console.error("[handleChatRequest V9] Failed to read LLM error response body:", e); }
        console.log(`[handleChatRequest V9] Returning ${llmResponse.status} (LLM API Error).`);
        return new Response(JSON.stringify({ error: 'Failed to get response from AI service.', details: errorText }), { status: llmResponse.status, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Process OK response ---
    console.log("[handleChatRequest V9] Processing OK response block...");
    let llmResult;
    try {
        console.log("[handleChatRequest V9] Parsing LLM JSON response...");
        llmResult = await llmResponse.json();
        console.log("[handleChatRequest V9] LLM JSON response parsed.");
    } catch (jsonError) {
        console.error('[handleChatRequest V9] Failed to parse LLM JSON response:', jsonError);
        console.log("[handleChatRequest V9] Returning 500 Internal Server Error (LLM JSON Parse Error).");
        return new Response(JSON.stringify({ error: 'Failed to parse AI response.', details: jsonError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const aiReply = llmResult.choices?.[0]?.message?.content?.trim();

    if (!aiReply) {
        console.error('[handleChatRequest V9] Could not extract AI reply from LLM response:', JSON.stringify(llmResult));
        console.log("[handleChatRequest V9] Returning 500 Internal Server Error (Parse Error - No Reply Content).");
        return new Response(JSON.stringify({ error: 'Failed to parse AI response (content missing).' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    console.log(`[handleChatRequest V9] Successfully extracted AI reply.`);

    // --- TODO: Token Tracking ---

    // --- Return AI Reply ---
    console.log("[handleChatRequest V9] Returning 200 OK with AI reply.");
    return new Response(JSON.stringify({ reply: aiReply }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[handleChatRequest V9] Unexpected error caught in try-catch block:', error);
    console.log("[handleChatRequest V9] Returning 500 Internal Server Error (Caught Exception).");
    return new Response(JSON.stringify({ error: 'Failed to process chat request.', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// --- TODO: Add updateTokenCount function later for KV ---