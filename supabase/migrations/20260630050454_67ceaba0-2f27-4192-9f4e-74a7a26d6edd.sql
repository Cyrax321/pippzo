
DROP POLICY IF EXISTS "media members read" ON storage.objects;
CREATE POLICY "media members read" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'media'
    AND public.is_workspace_member(
      ((string_to_array(name, '/'))[1])::uuid,
      auth.uid()
    )
  );

DROP POLICY IF EXISTS "media members write" ON storage.objects;
CREATE POLICY "media members write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'media'
    AND public.is_workspace_member(
      ((string_to_array(name, '/'))[1])::uuid,
      auth.uid()
    )
  );

DROP POLICY IF EXISTS "media members update" ON storage.objects;
CREATE POLICY "media members update" ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id = 'media'
    AND public.is_workspace_member(
      ((string_to_array(name, '/'))[1])::uuid,
      auth.uid()
    )
  );

DROP POLICY IF EXISTS "media members delete" ON storage.objects;
CREATE POLICY "media members delete" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'media'
    AND public.is_workspace_member(
      ((string_to_array(name, '/'))[1])::uuid,
      auth.uid()
    )
  );
