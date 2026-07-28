/*
 * Node 24 pode devolver uv_os_get_passwd/ENOMEM em hosts Windows executados
 * como serviço. O tsx usa os.userInfo() apenas para nomear sua pasta temporária;
 * este fallback mantém os scripts de build funcionais nesse ambiente.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("node:os");

try {
  os.userInfo();
} catch {
  os.userInfo = () => ({
    uid: -1,
    gid: -1,
    username: process.env.USERNAME || "theatrum",
    homedir: os.homedir(),
    shell: null,
  });
}
