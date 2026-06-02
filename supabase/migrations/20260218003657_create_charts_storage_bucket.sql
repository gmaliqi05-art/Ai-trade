/*
  # Create Charts Storage Bucket

  Sets up the storage bucket for chart image uploads used in the Chart Analysis feature.

  1. Creates a 'charts' storage bucket (public: false, 10MB file size limit)
  2. RLS policies:
     - Authenticated users can upload to their own folder
     - Authenticated users can read their own uploads
     - Authenticated users can delete their own uploads
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'charts',
  'charts',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/tiff']
) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload their own charts"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'charts' AND (storage.foldername(name))[1] = 'chart_analyses' AND auth.uid()::text = (storage.foldername(name))[2]);

CREATE POLICY "Users can read their own charts"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'charts' AND auth.uid()::text = (storage.foldername(name))[2]);

CREATE POLICY "Users can delete their own charts"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'charts' AND auth.uid()::text = (storage.foldername(name))[2]);
