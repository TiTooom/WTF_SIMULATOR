// Signature « ad hoc » de l'app macOS (sans certificat Apple payant).
// Sans signature, les Mac Apple Silicon refusent de lancer l'app ; avec celle-ci, elle démarre après un
// clic droit > Ouvrir (voir README). Ne fait rien sur Windows/Linux.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • signature ad hoc de ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
