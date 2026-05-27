export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginatedResultMetadata {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

/**
 * Standard query parser for pagination.
 * Resolves page and limit query keys safely. Prevents division by zero, float values,
 * negative parameters, or extremely large pagination requests that might overload server resources.
 */
export function parsePagination(
  query: Record<string, any>,
  defaultLimit = 10,
  maxLimit = 100
): PaginationParams {
  const page = Math.max(1, Math.floor(parseInt(query.page as string, 10) || 1));
  const limit = Math.min(
    maxLimit,
    Math.max(1, Math.floor(parseInt(query.limit as string, 10) || defaultLimit))
  );
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}
