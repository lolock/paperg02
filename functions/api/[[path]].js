/**
 * Cloudflare Worker entry point for handling API requests.
 * This function intercepts requests made to /api/*
 *
 * Environment variables expected:
 * - (Later) OPENAI_API_KEY: Your OpenAI-compatible API key.
 * - (Later) SYSTEM_PROMPT: The system prompt for the LLM.
 * - (Later) KV_NAMESPACE: Binding to the Cloudflare KV namespace.
 */

// Hardcoded valid login code for initial testing.
// TODO: Replace this with KV lookup later.
const VALID_LOGIN_CODE = "1234567890";

export async function onRequest(context) {
  // context includes:
  // - request: The incoming request object.
  // - env: Environment variables (including KV bindings).
  // - next: Function to invoke the next middleware/function (not used here).
  // - data: Data passed between functions (not used here).

  const { request, env } = context;
  const url = new URL(request.url);

  // Only respond to requests on the /api path
  if (!url.pathname.startsWith('/api/')) {
    return new Response('Not Found', { status: 404 });
  }

  // --- Request Routing ---
  try {
    // Handle Login requests
    if (url.pathname === '/api/login' && request.method === 'POST') {
      return handleLoginRequest(request, env);
    }

    // Handle Chat requests (Placeholder for now)
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      // TODO: Implement chat handling logic later
      // Requires checking login status (e.g., using a session token or verifying code again)
      return new Response(JSON.stringify({ message: 'Chat endpoint placeholder' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // --- Add other routes later (e.g., admin functions) ---

    // If no route matches
    return new Response(JSON.stringify({ error: 'API route not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error handling request:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Handles the /api/login POST request.
 * @param {Request} request - The incoming request object.
 * @param {object} env - Environment variables object.
 * @returns {Response} - The response object.
 */
async function handleLoginRequest(request, env) {
  try {
    // Check if the request body is JSON
    if (!request.headers.get('content-type')?.includes('application/json')) {
      return new Response(JSON.stringify({ error: 'Invalid request body type. Expected JSON.' }), {
        status: 400, // Bad Request
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const providedCode = body.code;

    if (!providedCode) {
      return new Response(JSON.stringify({ error: 'Login code is required.' }), {
        status: 400, // Bad Request
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- Login Code Validation (Hardcoded for now) ---
    // TODO: Replace this with a lookup in Cloudflare KV
    // const kvNamespace = env.KV_NAMESPACE;
    // const isValid = await kvNamespace.get(providedCode); // Check if code exists in KV

    if (providedCode === VALID_LOGIN_CODE) {
      // Successful login
      console.log(`Successful login attempt with code: ${providedCode}`);
      // In a real app, you might generate a session token here
      return new Response(JSON.stringify({ success: true, message: 'Login successful.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      // Failed login
      console.warn(`Failed login attempt with code: ${providedCode}`);
      return new Response(JSON.stringify({ success: false, error: 'Invalid login code.' }), {
        status: 401, // Unauthorized
        headers: { 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('Error in handleLoginRequest:', error);
    // Handle JSON parsing errors or other unexpected errors
     if (error instanceof SyntaxError) {
        return new Response(JSON.stringify({ error: 'Invalid JSON format in request body.' }), {
            status: 400, // Bad Request
             headers: { 'Content-Type': 'application/json' },
         });
    }
    return new Response(JSON.stringify({ error: 'Failed to process login request.', details: error.message }), {
      status: 500, // Internal Server Error
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// --- TODO: Add handleChatRequest function later ---