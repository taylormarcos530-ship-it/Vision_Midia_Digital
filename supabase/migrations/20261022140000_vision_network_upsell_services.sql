-- Rede de Pontos Vision: opt-in commercial services.
-- Master-global catalog, accessed only through the authenticated Master Edge endpoint.
-- No TV, Player, playlist, advertiser or existing point table is changed.
CREATE TABLE IF NOT EXISTS public.vision_network_addons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 100),
 description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
 price_cents integer NOT NULL CHECK (price_cents BETWEEN 0 AND 100000000),
 eligible_plan_slots smallint[] NOT NULL DEFAULT '{1,2,3}'::smallint[],
 active boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 100000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id),
 CONSTRAINT eligible_slots_valid CHECK (
   eligible_plan_slots <@ ARRAY[1,2,3]::smallint[]
   AND cardinality(eligible_plan_slots) BETWEEN 0 AND 3
 )
);
CREATE INDEX IF NOT EXISTS vision_network_addons_public_idx
 ON public.vision_network_addons (active, sort_order, created_at);
ALTER TABLE public.vision_network_addons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vision_network_addons FROM anon, authenticated;
-- Only privileged service-role requests, after explicit Master authentication,
-- may read or mutate service configuration. Do not create permissive RLS policies.
INSERT INTO public.vision_network_addons
 (name, description, price_cents, eligible_plan_slots, active, sort_order)
 SELECT
  'Criação de Vídeo com IA',
  E'Vídeo publicitário de 10 ou 15 segundos.\nProdução com inteligência artificial.\nInclui uma revisão simples.\nPagamento único.',
  2500, ARRAY[1,2,3]::smallint[], true, 10
 WHERE NOT EXISTS (
  SELECT 1 FROM public.vision_network_addons WHERE name='Criação de Vídeo com IA'
 );
