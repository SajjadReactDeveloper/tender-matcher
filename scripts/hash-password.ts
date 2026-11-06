// Usage: npx tsx scripts/hash-password.ts "your password"
// Prints the value to put in APP_PASSWORD_HASH. Use single quotes in bash for passwords containing $.
import { hashPassword } from '../src/lib/auth/password';

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: npx tsx scripts/hash-password.ts "your password"');
    process.exit(1);
  }
  console.log(await hashPassword(password));
}

main();
