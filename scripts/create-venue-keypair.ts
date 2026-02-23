import { writeFileSync, mkdirSync } from 'fs';
import bs58 from 'bs58';

// Venue wallet private key (devnet only)
const privateKeyBase58 = '5oNSRrVQCZ85TpsypmBWmNVf53XZqYUQAW7LQPQN9ecJrfeZU3PtrTdioAUng2FXmmtBNhDX5hzVxp1YaZaEU2mB';

// Decode base58 private key to byte array
const secretKey = bs58.decode(privateKeyBase58);

// Save as JSON array (Solana CLI format)
mkdirSync('./wallets', { recursive: true });
writeFileSync('./wallets/venue-wallet.json', JSON.stringify(Array.from(secretKey)));

console.log('Venue keypair saved to ./wallets/venue-wallet.json');
console.log('Public key: AMowwS1iaoKZMMwJxWY5jdeCKukbm64XyZEg8fwbXCPw');