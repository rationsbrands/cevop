-- Store the URL of the selfie taken at clock-in time.
-- Photo itself lives in Supabase Storage; this is just the pointer.
-- Nullable — kiosks without camera access or before feature was deployed have no photo.
ALTER TABLE "staff_shifts" ADD COLUMN "clockInPhotoUrl" TEXT;
