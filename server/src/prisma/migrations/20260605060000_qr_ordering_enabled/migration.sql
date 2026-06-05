-- Allow orgs to disable customer QR ordering (staff-only POS mode)
ALTER TABLE "organizations"
  ADD COLUMN "qrOrderingEnabled" BOOLEAN NOT NULL DEFAULT true;
