#!/usr/bin/env node

/**
 * Test script to validate Vikunja MCP server functionality
 */

const { spawn } = require('child_process');
const path = require('path');

// Configuration from the mandatory protocol
const config = {
  vikunja: {
    command: 'node',
    args: [path.join(__dirname, 'dist', 'index.js')],
    env: {
      'VIKUNJA_URL': 'https://vikunja.erinjeremy.com/api/v1',
      'VIKUNJA_API_TOKEN': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token'
    }
  }
};

class MCPTester {
  constructor() {
    this.server = null;
    this.messageId = 1;
  }

  async startServer() {
    console.log('🚀 Starting Vikunja MCP Server...');

    this.server = spawn(config.vikunja.command, config.vikunja.args, {
      env: { ...process.env, ...config.vikunja.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.server.on('error', (error) => {
      console.error('❌ Server error:', error);
    });

    this.server.stderr.on('data', (data) => {
      console.log('📝 Server log:', data.toString().trim());
    });

    // Wait for server to be ready
    await this.sleep(1000);
    console.log('✅ Server started successfully');
  }

  async sendRequest(method, params = {}) {
    const request = {
      jsonrpc: '2.0',
      method,
      params,
      id: this.messageId++
    };

    console.log(`📤 Sending request: ${method}`, params);

    return new Promise((resolve, reject) => {
      let responseData = '';

      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout for ${method}`));
      }, 10000);

      this.server.stdout.on('data', (data) => {
        responseData += data.toString();

        // Try to parse complete JSON responses
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              clearTimeout(timeout);
              console.log(`📥 Response received:`, response);
              resolve(response);
              return;
            }
          } catch (e) {
            // Not valid JSON yet, continue collecting
          }
        }
      });

      this.server.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async testInitialization() {
    console.log('\n🔧 Testing server initialization...');

    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: {
          listChanged: true
        }
      },
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    });

    if (response.result && response.result.serverInfo) {
      console.log('✅ Initialization successful');
      console.log(`📊 Server: ${response.result.serverInfo.name} v${response.result.serverInfo.version}`);
      return true;
    } else {
      console.log('❌ Initialization failed');
      return false;
    }
  }

  async listTools() {
    console.log('\n🔍 Listing available tools...');

    const response = await this.sendRequest('tools/list');

    if (response.result && response.result.tools) {
      console.log('✅ Tools list retrieved successfully');
      console.log(`📊 Found ${response.result.tools.length} tools:`);
      response.result.tools.forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.description}`);
      });
      return response.result.tools;
    } else {
      console.log('❌ Failed to list tools');
      return [];
    }
  }

  async testTaskOperations() {
    console.log('\n🧪 Testing basic task operations...');

    try {
      // Test task list operation
      const response = await this.sendRequest('tools/call', {
        name: 'vikunja_tasks',
        arguments: {
          subcommand: 'list',
          limit: 5
        }
      });

      if (response.result && response.result.content) {
        console.log('✅ Task list operation successful');
        console.log('📊 Response content:', response.result.content);

        // Parse the task data
        const tasks = JSON.parse(response.result.content[0].text);
        console.log(`📊 Found ${tasks.length} tasks`);

        if (tasks.length > 0) {
          console.log('📝 First task:', tasks[0]);
        }
        return true;
      } else {
        console.log('❌ Task list operation failed');
        console.log('Response:', response);
        return false;
      }
    } catch (error) {
      console.log('❌ Task operation error:', error.message);
      return false;
    }
  }

  async testProjectOperations() {
    console.log('\n🏗️ Testing basic project operations...');

    try {
      // Test project list operation
      const response = await this.sendRequest('tools/call', {
        name: 'vikunja_projects',
        arguments: {
          subcommand: 'list',
          limit: 5
        }
      });

      if (response.result && response.result.content) {
        console.log('✅ Project list operation successful');
        console.log('📊 Response content:', response.result.content);

        // Parse the project data
        const projects = JSON.parse(response.result.content[0].text);
        console.log(`📊 Found ${projects.length} projects`);

        if (projects.length > 0) {
          console.log('📝 First project:', projects[0]);
        }
        return true;
      } else {
        console.log('❌ Project list operation failed');
        console.log('Response:', response);
        return false;
      }
    } catch (error) {
      console.log('❌ Project operation error:', error.message);
      return false;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async stopServer() {
    if (this.server) {
      console.log('\n🛑 Stopping server...');
      this.server.kill();
      await this.sleep(500);
      console.log('✅ Server stopped');
    }
  }

  async runTests() {
    try {
      await this.startServer();

      const initSuccess = await this.testInitialization();
      if (!initSuccess) {
        throw new Error('Server initialization failed');
      }

      const tools = await this.listTools();

      // Test basic functionality
      const taskSuccess = await this.testTaskOperations();
      const projectSuccess = await this.testProjectOperations();

      console.log('\n📋 Test Results Summary:');
      console.log(`  - Server Initialization: ${initSuccess ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`  - Tools Listed: ${tools.length > 0 ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`  - Task Operations: ${taskSuccess ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`  - Project Operations: ${projectSuccess ? '✅ PASS' : '❌ FAIL'}`);

      return {
        initialization: initSuccess,
        toolsCount: tools.length,
        taskOperations: taskSuccess,
        projectOperations: projectSuccess
      };

    } catch (error) {
      console.error('❌ Test suite failed:', error);
      return null;
    } finally {
      await this.stopServer();
    }
  }
}

// Run the tests
async function main() {
  const tester = new MCPTester();
  const results = await tester.runTests();

  if (results) {
    console.log('\n🎉 Basic functionality testing completed!');
    process.exit(results.taskOperations && results.projectOperations ? 0 : 1);
  } else {
    console.log('\n💥 Basic functionality testing failed!');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { MCPTester };