/**
 * Consistent success envelope for all endpoints:
 *   { success: true, data, message? }
 * Errors use the matching shape via the error middleware:
 *   { success: false, message, details? }
 */
export function sendSuccess(res, data = null, { status = 200, message } = {}) {
  const body = { success: true, data };
  if (message) body.message = message;
  return res.status(status).json(body);
}

export default sendSuccess;
