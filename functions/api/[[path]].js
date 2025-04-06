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
  const { request, env } = context;
  const url = new URL(request.url);

  // --- Only process requests starting with /api/ ---
  if (url.pathname.startsWith('/api/')) {
    try {
      // --- API Request Routing ---

      // Handle Login requests
      if (url.pathname === '/api/login' && request.method === 'POST') {
        return handleLoginRequest(request, env); // Return the response from the handler
      }

      // Handle Chat requests (Placeholder for now)
      if (url.pathname === '/api/chat' && request.method === 'POST') {
        // TODO: Implement chat handling logic later
        // Requires checking login status (e.g., using a session token or verifying code again)
        return new Response(JSON.stringify({ message: 'Chat endpoint placeholder' }), { // Return the response
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      // --- Add other API routes later (e.g., admin functions) ---

      // If no API route matches inside /api/
      return new Response(JSON.stringify({ error: 'API route not found' }), { // Return 404 for unknown API routes
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('Error handling API request:', error);
      return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), { // Return 500 for errors within API handlers
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // --- If the path does NOT start with /api/ ---
  // This function does not return anything here.
  // Cloudflare Pages will automatically look for a matching static file in the 'public' directory.
  // For example, if the request is for '/script.js', Pages will serve 'public/script.js'.
  // If the request is for '/', Pages will serve 'public/index.html'.

  // If you need to explicitly pass the request to the static asset handler (less common now):
  // return context.next();
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
