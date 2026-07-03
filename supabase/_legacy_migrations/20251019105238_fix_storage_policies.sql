/*
  # Fix Storage Bucket Policies for Public Access

  1. Changes
    - Drop existing restrictive storage policies
    - Create new policies that allow public or anon access
    - Ensure users can upload, view, and delete files
  
  2. Security
    - Allow anon and authenticated users to upload
    - Allow anon and authenticated users to view files
    - Allow anon and authenticated users to delete files
*/

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload images" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own images" ON storage.objects;

-- Create new public policies for documents bucket
CREATE POLICY "Public can upload documents"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Public can view documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'documents');

CREATE POLICY "Public can update documents"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'documents')
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Public can delete documents"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'documents');

-- Create new public policies for images bucket
CREATE POLICY "Public can upload images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'images');

CREATE POLICY "Public can view images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'images');

CREATE POLICY "Public can update images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'images')
  WITH CHECK (bucket_id = 'images');

CREATE POLICY "Public can delete images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'images');

-- Make buckets public for easier access
UPDATE storage.buckets 
SET public = true 
WHERE id IN ('documents', 'images');
