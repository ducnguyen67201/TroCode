export async function inTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

export function conflict(code, message) {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  return error;
}
