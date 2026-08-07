"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const app_js_1 = __importDefault(require("../../src/app.js"));
describe('GET /health Integration Test', () => {
    it('should return HTTP 200 OK with enriched health information', async () => {
        const response = await (0, supertest_1.default)(app_js_1.default).get('/health');
        expect(response.status).toBe(200);
        const body = response.body;
        expect(body['status']).toBe('UP');
        expect(body['service']).toBe('Flux');
        expect(typeof body['version']).toBe('string');
        expect(typeof body['uptime']).toBe('number');
        expect(typeof body['timestamp']).toBe('string');
    });
    it('should return HTTP 404 for an unregistered route with standardized error format', async () => {
        const response = await (0, supertest_1.default)(app_js_1.default).get('/non-existent-endpoint');
        expect(response.status).toBe(404);
        const body = response.body;
        expect(body.success).toBe(false);
        expect(body.error).toEqual({
            code: 'NOT_FOUND',
            message: 'Route GET /non-existent-endpoint not found',
            details: null,
        });
        expect(typeof body.timestamp).toBe('string');
        expect(body.path).toBe('/non-existent-endpoint');
    });
});
//# sourceMappingURL=health.test.js.map