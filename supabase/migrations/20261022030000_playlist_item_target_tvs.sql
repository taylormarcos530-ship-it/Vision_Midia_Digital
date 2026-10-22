-- Select TVs per playlist item without changing the playlist or Android player.
-- NULL = all TVs using the playlist (backward-compatible). Nonempty UUID[] = selected TVs.
ALTER TABLE public.playlist_items
  ADD COLUMN IF NOT EXISTS target_device_ids uuid[] DEFAULT NULL;

COMMENT ON COLUMN public.playlist_items.target_device_ids IS
  'NULL = every TV receiving the playlist; nonempty UUID array = only these TVs.';

CREATE OR REPLACE FUNCTION private.validate_playlist_item_target_devices()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.target_device_ids IS NULL THEN
    RETURN NEW;
  END IF;
  IF cardinality(NEW.target_device_ids) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_target_tv_count' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(DISTINCT target_id) FROM unnest(NEW.target_device_ids) AS target_id)
      <> cardinality(NEW.target_device_ids) THEN
    RAISE EXCEPTION 'duplicate_target_tvs' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.target_device_ids) AS target_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.devices AS d
      WHERE d.id = target_id
        AND d.company_id = NEW.company_id
        AND d.retired_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'invalid_or_cross_company_target_tv' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS playlist_items_validate_target_devices ON public.playlist_items;
CREATE TRIGGER playlist_items_validate_target_devices
  BEFORE INSERT OR UPDATE OF target_device_ids, company_id
  ON public.playlist_items FOR EACH ROW
  EXECUTE FUNCTION private.validate_playlist_item_target_devices();
