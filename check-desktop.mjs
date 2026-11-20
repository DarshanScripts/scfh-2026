import { initializeLogger } from '@livekit/agents';
import { createDesktopServer, desktopCommand, desktopText } from './desktop.mjs';

initializeLogger({ level: 'error' });
const server = createDesktopServer(({ result }) => desktopText(result.content));
try {
  await server.initialize();
  const tools = await server.listTools();
  const snapshot = tools.find((tool) => tool.name === 'Snapshot');
  if (!snapshot || !tools.some((tool) => tool.name === 'Click')) {
    throw new Error('Windows-MCP did not advertise Snapshot and Click.');
  }
  const state = await snapshot.execute({ use_vision: false }, {});
  if (!/Active Desktop:/.test(state) || !/UI Tree:/.test(state)) {
    throw new Error('The driver connected but could not read the current desktop.');
  }
  console.log('Windows-MCP connected and read the local desktop.');
} catch (error) {
  console.error('Could not connect to Windows-MCP via ' + desktopCommand() + '.');
  console.error('See the platform setup in README.md. ' + error.message);
  process.exitCode = 1;
} finally {
  await server.aclose();
}
