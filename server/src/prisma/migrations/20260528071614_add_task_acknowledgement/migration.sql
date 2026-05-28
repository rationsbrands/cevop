-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "escalationLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastEscalatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "escalationLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastEscalatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "waiter_calls" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "escalationLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastEscalatedAt" TIMESTAMP(3);
