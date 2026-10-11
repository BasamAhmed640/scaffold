# Scaffold in ChatGPT

ChatGPT can use the same Scaffold vault and Anki setup through a private [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels). Install the packaged tutor skill as well as the tool connection: the MCP server's short initialization instructions do not contain the full Tutor Protocol.

This is a private setup. The account/workspace must allow custom MCP servers and private plugin installation. Platform tunnel access and ChatGPT permissions are separate. The tunnel needs Read + Manage to create, and Read + Use to operate; its associations must include the intended ChatGPT workspace. Keep its runtime key in a protected local file, outside Git. Scaffold calls no model API itself.

## Connect the local tools

1. Run `npm.cmd run update` in the Scaffold repo to build the server and generate the skill. Keep Anki open if you want immediate card updates.
2. Create a tunnel in [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels). Associate it with your ChatGPT workspace, and download the current Windows `tunnel-client` from the link there.
3. Run `tunnel-client.exe help quickstart` and follow that version's setup guidance. Point its stdio MCP command at the built server, with the same vault you already use. For example, a managed runtime can be started with:

   ```powershell
   $mcpCommand = '"C:/path/to/node.exe" "C:/path/to/scaffold/build/mcpb/server/index.mjs" --vault "C:/path/to/vault"'
   tunnel-client.exe runtimes connect --alias scaffold-tutor --profile scaffold-tutor --profile-dir 'C:/path/to/scaffold/local/tunnel-profiles' --tunnel-id tunnel_YOUR_ID --runtime-api-key 'file:C:/path/to/protected-key-file' --mcp-command $mcpCommand --json
   tunnel-client.exe runtimes status scaffold-tutor --json
   ```

   Replace the example paths and ID. The running client must report healthy and ready. Use its local `/ui` page or status command to check; the client and computer must remain running for ChatGPT tool calls.
4. In [ChatGPT Plugins](https://chatgpt.com/plugins), choose **+ → Add custom MCP server → Tunnel**. Select your tunnel, or enter its ID. Set **Authentication → No authentication**; Scaffold has no separate MCP OAuth login. Review the connection's permissions and create the private plugin. Copy the technical ID from its URL: `plugin_asdk_app_…`.

If ChatGPT says custom apps are not allowed in this context, resolve the account/workspace policy first. A healthy tunnel does not grant permission to register or use an app. See [OpenAI's connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

## Install the full tutor skill

From the repo, package the generated protocol with that registered connection:

```powershell
npm.cmd run build:chatgpt -- --app-id plugin_asdk_app_YOUR_ID
```

The output is `dist/scaffold-chatgpt-plugin.zip`. It contains the skill and references, portable `plugin.json`, and `.app.json` linking the existing MCP connection. The script converts the URL's `plugin_asdk_app_…` ID into the underlying `asdk_app_…` ID required by the mapping. It includes no vault data, runtime key or machine-specific server command.

Use **Upload plugin archive** in ChatGPT's private Plugins menu to install this archive, then enable **Scaffold Tutor** in a new chat. Where archive upload is unavailable, use an account-supported private marketplace route from [OpenAI's packaging guide](https://developers.openai.com/plugins/build/plugins). Public Skills-only submission removes registered MCP mappings and is not this setup.

## Verify before studying

In that new chat, send:

> Use the Scaffold doctor tool and tell me which vault it is checking. Don't start a session.

Confirm the reported vault is the intended one and check any warnings. Then say **Start a session on …** when ready. Keep only one tutoring session open across Claude, Codex and ChatGPT. ChatGPT uses MCP to fetch visual source; the saved visual files remain in the local vault.

## After a change

Run `npm.cmd run update`, then rebuild the ChatGPT archive with the same registered connection ID and replace the installed archive. Refresh/restart the managed tunnel runtime when the server changes so its child process uses the new bundle; use the installed CLI's help for restart controls. Test `doctor` again in a new chat. The update script handles Codex and Claude, but does not replace a ChatGPT plugin upload.

Keep real connection IDs, profile files, keys and installation records under ignored `local/` or protected local storage. Do not commit the generated archive or learner vault.
