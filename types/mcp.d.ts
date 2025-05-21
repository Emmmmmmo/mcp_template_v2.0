     declare module '@modelcontextprotocol/sdk/client/index.js' {
       export class Client {
         constructor(options: { name: string; version: string; capabilities?: any[] });
         transport?: any;
         connect(transport: any): Promise<void>;
         listTools(): Promise<any[]>;
         callTool(options: { name: string; arguments: Record<string, any> }): Promise<any>;
         close(): Promise<void>;
       }
     }

     declare module '@modelcontextprotocol/sdk/client/sse.js' {
       export class SSEClientTransport {
         constructor(url: URL);
         close(): Promise<void>;
       }
     }
