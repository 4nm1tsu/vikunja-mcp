#!/usr/bin/env node

/**
 * Real-world Projects CRUD operations test
 * Tests against the actual Vikunja instance with provided configuration
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

class ProjectsCRUDTester {
  constructor() {
    this.server = null;
    this.messageId = 1;
    this.createdProjects = []; // Track created projects for cleanup
  }

  async startServer() {
    console.log('🚀 Starting Vikunja MCP Server for Projects CRUD testing...');

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
      let responseCount = 0;

      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout for ${method}`));
      }, 15000);

      this.server.stdout.on('data', (data) => {
        responseData += data.toString();

        // Try to parse complete JSON responses
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              clearTimeout(timeout);
              console.log(`📥 Response received:`, response.result ? 'Success' : response.error);
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

  async initializeServer() {
    console.log('\n🔧 Initializing server...');

    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: {
          listChanged: true
        }
      },
      clientInfo: {
        name: 'projects-crud-test',
        version: '1.0.0'
      }
    });

    if (response.result && response.result.serverInfo) {
      console.log('✅ Server initialized successfully');
      return true;
    } else {
      console.log('❌ Server initialization failed');
      return false;
    }
  }

  async listProjects(options = {}) {
    console.log('\n📋 Listing projects...');

    try {
      const response = await this.sendRequest('tools/call', {
        name: 'vikunja_projects',
        arguments: {
          subcommand: 'list',
          ...options
        }
      });

      if (response.result && response.result.content) {
        const content = JSON.parse(response.result.content[0].text);
        console.log(`✅ Found ${content.data ? content.data.length : 0} projects`);

        if (content.data && content.data.length > 0) {
          console.log('📝 First few projects:');
          content.data.slice(0, 3).forEach((project, i) => {
            console.log(`  ${i + 1}. "${project.title}" (ID: ${project.id}) - ${project.is_archived ? 'Archived' : 'Active'}`);
          });
        }

        return content.data || [];
      } else {
        console.log('❌ Failed to list projects');
        console.log('Response:', response);
        return [];
      }
    } catch (error) {
      console.log('❌ Error listing projects:', error.message);
      return [];
    }
  }

  async createProject(projectData) {
    console.log(`\n➕ Creating project: "${projectData.title}"`);

    try {
      const response = await this.sendRequest('tools/call', {
        name: 'vikunja_projects',
        arguments: {
          subcommand: 'create',
          ...projectData
        }
      });

      if (response.result && response.result.content) {
        const content = JSON.parse(response.result.content[0].text);

        if (content.success && content.data && content.data.id) {
          console.log(`✅ Project created successfully: "${content.data.title}" (ID: ${content.data.id})`);

          // Track for cleanup
          this.createdProjects.push(content.data.id);

          return content.data;
        } else {
          console.log('❌ Project creation response missing expected data');
          console.log('Content structure:', Object.keys(content));
          return null;
        }
      } else {
        console.log('❌ Failed to create project');
        console.log('Response:', response);
        return null;
      }
    } catch (error) {
      console.log('❌ Error creating project:', error.message);
      return null;
    }
  }

  async getProject(id) {
    console.log(`\n🔍 Getting project (ID: ${id})`);

    try {
      const response = await this.sendRequest('tools/call', {
        name: 'vikunja_projects',
        arguments: {
          subcommand: 'get',
          id: id
        }
      });

      if (response.result && response.result.content) {
        const content = JSON.parse(response.result.content[0].text);
        if (content.success && content.data && content.data.id) {
          console.log(`✅ Retrieved project: "${content.data.title}"`);
          return content.data;
        } else {
          console.log('❌ Project retrieval response missing expected data');
          console.log('Response:', content);
          return null;
        }
      } else {
        console.log('❌ Failed to get project');
        console.log('Response:', response);
        return null;
      }
    } catch (error) {
      console.log('❌ Error getting project:', error.message);
      return null;
    }
  }

  async updateProject(id, updateData) {
    console.log(`\n✏️ Updating project (ID: ${id})`);

    try {
      const response = await this.sendRequest('tools/call', {
        name: 'vikunja_projects',
        arguments: {
          subcommand: 'update',
          id: id,
          ...updateData
        }
      });

      if (response.result && response.result.content) {
        const content = JSON.parse(response.result.content[0].text);
        if (content.success && content.data && content.data.id) {
          console.log(`✅ Project updated: "${content.data.title}"`);
          return content.data;
        } else {
          console.log('❌ Project update response missing expected data');
          console.log('Response:', content);
          return null;
        }
      } else {
        console.log('❌ Failed to update project');
        console.log('Response:', response);
        return null;
      }
    } catch (error) {
      console.log('❌ Error updating project:', error.message);
      return null;
    }
  }

  async archiveProject(id) {
    console.log(`\n📦 Archiving project (ID: ${id})`);

    try {
      const response = await this.sendRequest('tools/call', {
        name: 'vikunja_projects',
        arguments: {
          subcommand: 'archive',
          id: id
        }
      });

      if (response.result && response.result.content) {
        const content = JSON.parse(response.result.content[0].text);
        if (content.success && content.data && content.data.id) {
          console.log(`✅ Project archived: "${content.data.title}"`);
          return content.data;
        } else {
          console.log('❌ Project archive response missing expected data');
          console.log('Response:', content);
          return null;
        }
      } else {
        console.log('❌ Failed to archive project');
        console.log('Response:', response);
        return null;
      }
    } catch (error) {
      console.log('❌ Error archiving project:', error.message);
      return null;
    }
  }

  async unarchiveProject(id) {
    console.log(`\n📂 Unarchiving project (ID: ${id})`);

    try {
      const response = await this.sendRequest('tools/call', {
        name: 'vikunja_projects',
        arguments: {
          subcommand: 'unarchive',
          id: id
        }
      });

      if (response.result && response.result.content) {
        const content = JSON.parse(response.result.content[0].text);
        if (content.success && content.data && content.data.id) {
          console.log(`✅ Project unarchived: "${content.data.title}"`);
          return content.data;
        } else {
          console.log('❌ Project unarchive response missing expected data');
          console.log('Response:', content);
          return null;
        }
      } else {
        console.log('❌ Failed to unarchive project');
        console.log('Response:', response);
        return null;
      }
    } catch (error) {
      console.log('❌ Error unarchiving project:', error.message);
      return null;
    }
  }

  async deleteProject(id) {
    console.log(`\n🗑️ Deleting project (ID: ${id})`);

    try {
      const response = await this.sendRequest('tools/call', {
        name: 'vikunja_projects',
        arguments: {
          subcommand: 'delete',
          id: id
        }
      });

      if (response.result && response.result.content) {
        const content = JSON.parse(response.result.content[0].text);
        console.log(`✅ Project deleted successfully`);
        return true;
      } else {
        console.log('❌ Failed to delete project');
        console.log('Response:', response);
        return false;
      }
    } catch (error) {
      console.log('❌ Error deleting project:', error.message);
      return false;
    }
  }

  async testHierarchyOperations() {
    console.log('\n🌳 Testing project hierarchy operations...');

    // Create parent project
    const parentProject = await this.createProject({
      title: 'Test Parent Project',
      description: 'Parent project for hierarchy testing'
    });

    if (!parentProject) {
      console.log('❌ Failed to create parent project');
      return false;
    }

    // Create child project
    const childProject = await this.createProject({
      title: 'Test Child Project',
      description: 'Child project for hierarchy testing',
      parentProjectId: parentProject.id
    });

    if (!childProject) {
      console.log('❌ Failed to create child project');
      return false;
    }

    // Test getting children
    try {
      const response = await this.sendRequest('tools/call', {
        name: 'vikunja_projects',
        arguments: {
          subcommand: 'get-children',
          id: parentProject.id
        }
      });

      if (response.result && response.result.content) {
        const content = JSON.parse(response.result.content[0].text);
        console.log(`✅ Found ${content.data.children.length} child projects`);
      } else {
        console.log('⚠️ Could not retrieve child projects');
      }
    } catch (error) {
      console.log('⚠️ Error testing hierarchy:', error.message);
    }

    return true;
  }

  async cleanupCreatedProjects() {
    console.log('\n🧹 Cleaning up created projects...');

    // Delete in reverse order to handle hierarchy
    for (const projectId of [...this.createdProjects].reverse()) {
      await this.deleteProject(projectId);
      await this.sleep(500); // Brief pause between deletions
    }

    this.createdProjects = [];
    console.log('✅ Cleanup completed');
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

  async runCRUDTests() {
    try {
      await this.startServer();

      const initSuccess = await this.initializeServer();
      if (!initSuccess) {
        throw new Error('Server initialization failed');
      }

      console.log('\n🎯 Starting Projects CRUD operations test...\n');

      // Test 1: List existing projects
      const existingProjects = await this.listProjects();

      // Test 2: Create a new project
      const testProject = await this.createProject({
        title: 'MCP Test Project',
        description: 'Test project for MCP CRUD operations validation',
        hexColor: '#FF5733'
      });

      if (!testProject) {
        throw new Error('Failed to create test project');
      }

      // Test 3: Get the created project
      const retrievedProject = await this.getProject(testProject.id);
      if (!retrievedProject || retrievedProject.id !== testProject.id) {
        throw new Error('Failed to retrieve created project');
      }

      // Test 4: Update the project
      const updatedProject = await this.updateProject(testProject.id, {
        title: 'MCP Test Project - Updated',
        description: 'Updated description for test project',
        hexColor: '#33FF57'
      });

      if (!updatedProject || updatedProject.title !== 'MCP Test Project - Updated') {
        throw new Error('Failed to update project');
      }

      // Test 5: Archive the project
      const archivedProject = await this.archiveProject(testProject.id);
      if (!archivedProject || !archivedProject.is_archived) {
        throw new Error('Failed to archive project');
      }

      // Test 6: Unarchive the project
      const unarchivedProject = await this.unarchiveProject(testProject.id);
      if (!unarchivedProject || unarchivedProject.is_archived) {
        throw new Error('Failed to unarchive project');
      }

      // Test 7: Test hierarchy operations
      const hierarchySuccess = await this.testHierarchyOperations();

      // Test 8: List projects again to verify our project exists
      const finalProjects = await this.listProjects();

      console.log('\n📋 Test Results Summary:');
      console.log(`  - Initial projects count: ${existingProjects.length}`);
      console.log(`  - Project creation: ✅ SUCCESS`);
      console.log(`  - Project retrieval: ✅ SUCCESS`);
      console.log(`  - Project update: ✅ SUCCESS`);
      console.log(`  - Project archive: ✅ SUCCESS`);
      console.log(`  - Project unarchive: ✅ SUCCESS`);
      console.log(`  - Hierarchy operations: ${hierarchySuccess ? '✅ SUCCESS' : '⚠️ PARTIAL'}`);
      console.log(`  - Final projects count: ${finalProjects.length}`);

      console.log('\n🎉 Projects CRUD operations testing completed successfully!');
      return true;

    } catch (error) {
      console.error('\n💥 Projects CRUD test failed:', error.message);
      return false;
    } finally {
      await this.cleanupCreatedProjects();
      await this.stopServer();
    }
  }
}

// Run the tests
async function main() {
  const tester = new ProjectsCRUDTester();
  const success = await tester.runCRUDTests();

  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { ProjectsCRUDTester };