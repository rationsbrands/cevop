const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN "emailVerified" TIMESTAMP(3);`);
    console.log('Added emailVerified column.');
  } catch (e) {
    console.log('Column emailVerified might already exist:', e.message);
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN "emailVerificationToken" TEXT;`);
    console.log('Added emailVerificationToken column.');
  } catch (e) {
    console.log('Column emailVerificationToken might already exist:', e.message);
  }

  try {
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX "users_emailVerificationToken_key" ON "users"("emailVerificationToken");`,
    );
    console.log('Added unique index on emailVerificationToken.');
  } catch (e) {
    console.log('Index might already exist:', e.message);
  }

  console.log('Migration completed successfully.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
