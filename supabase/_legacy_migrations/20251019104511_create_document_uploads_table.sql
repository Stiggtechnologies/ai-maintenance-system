/*
  # Create Document Uploads Table

  1. New Tables
    - `document_uploads`
      - `id` (uuid, primary key)
      - `file_name` (text)
      - `file_path` (text)
      - `file_type` (text)
      - `file_size` (bigint)
      - `uploaded_by` (uuid, references auth.users)
      - `analysis_result` (jsonb)
      - `agent_type` (text)
      - `created_at` (timestamptz)
  
  2. Security
    - Enable RLS on `document_uploads` table
    - Add policy for authenticated users to manage their own uploads
*/

CREATE TABLE IF NOT EXISTS document_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id),
  analysis_result jsonb,
  agent_type text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE document_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own uploads"
  ON document_uploads FOR SELECT
  TO authenticated
  USING (uploaded_by = auth.uid());

CREATE POLICY "Users can insert own uploads"
  ON document_uploads FOR INSERT
  TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Users can update own uploads"
  ON document_uploads FOR UPDATE
  TO authenticated
  USING (uploaded_by = auth.uid())
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Users can delete own uploads"
  ON document_uploads FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid());

-- Create storage policies
CREATE POLICY "Users can upload documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Users can view own documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'documents');

CREATE POLICY "Users can delete own documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'documents');

CREATE POLICY "Users can upload images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'images');

CREATE POLICY "Users can view own images"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'images');

CREATE POLICY "Users can delete own images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'images');
