-- New video provider kinds shipped in the adapter registry (gemini-omni,
-- seedance) were rejected by the original CHECK constraint. Widen it to the
-- full supported + coming-soon set.
alter table public.video_providers drop constraint if exists video_providers_provider_check;
alter table public.video_providers add constraint video_providers_provider_check
  check (provider in ('veo', 'gemini-omni', 'seedance', 'kling', 'runway', 'luma', 'custom'));
