/**
 * Netlify Function handler.
 * Connects to MongoDB (reusing connection if active) and proxies the request to Express.
 */
export declare const handler: (event: any, context: any) => Promise<Object | {
    statusCode: number;
    headers: {
        "Content-Type": string;
    };
    body: string;
}>;
//# sourceMappingURL=api.d.ts.map