import React, { useState, useMemo, useEffect, useRef } from 'react';
import { APIProvider, Map as MapaGoogle, useMap, InfoWindow } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { ScatterplotLayer } from '@deck.gl/layers';
import {
  Waves,
  Search,
  SlidersHorizontal,
  RotateCcw,
  MapPin,
  Layers,
  Mountain,
  ArrowUpFromLine,
} from 'lucide-react';

const GCS_GEOJSON_URL = import.meta.env.VITE_GCS_GEOJSON_URL as string;
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

const PALETA_CORES: [number, number, number][] = [
  [239, 68, 68],
  [59, 130, 246],
  [16, 185, 129],
  [245, 158, 11],
  [139, 92, 246],
  [236, 72, 153],
  [6, 182, 212],
  [249, 115, 22],
];

interface GeoFeature {
  type: string;
  geometry: {
    type: string;
    coordinates: [number, number];
  };
  properties: {
    categoria?: string;
    altura_min_acima_do_rio_m?: number;
    Inclinaxao_graus?: number;
    inclinacao_graus?: number;
    nome_subbacia_n6?: string;
    descricao_estabelecimento?: string;
    [key: string]: any;
  };
}

function CamadaBolinhasDeckGL({
  dados,
  mapaCores,
  aoClicarPonto,
}: {
  dados: GeoFeature[];
  mapaCores: Record<string, [number, number, number]>;
  aoClicarPonto: (ponto: GeoFeature | null) => void;
}) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);

  useEffect(() => {
    if (!map) return;
    const overlay = new GoogleMapsOverlay({ layers: [] });
    overlay.setMap(map);
    overlayRef.current = overlay;

    return () => {
      overlay.setMap(null);
    };
  }, [map]);

  useEffect(() => {
    if (!overlayRef.current) return;

    const layer = new ScatterplotLayer<GeoFeature>({
      id: 'pontos-inundacao-itajai',
      data: dados,
      pickable: true,
      opacity: 0.85,
      stroked: true,
      filled: true,
      radiusScale: 1,
      radiusMinPixels: 4,
      radiusMaxPixels: 14,
      lineWidthMinPixels: 1,
      getPosition: (d) => d.geometry.coordinates,
      getRadius: 25,
      getFillColor: (d) => {
        const cat = d.properties?.categoria || 'Outros';
        return mapaCores[cat] || [100, 116, 139];
      },
      getLineColor: [255, 255, 255, 210],
      onClick: (info) => {
        if (info.object) aoClicarPonto(info.object);
      },
      updateTriggers: {
        getFillColor: [mapaCores],
      },
    });

    overlayRef.current.setProps({ layers: [layer] });
  }, [dados, mapaCores, aoClicarPonto]);

  return null;
}

export default function App() {
  const [dadosBrutos, setDadosBrutos] = useState<GeoFeature[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [pontoSelecionado, setPontoSelecionado] = useState<GeoFeature | null>(null);

  const [categoriasAtivas, setCategoriasAtivas] = useState<string[]>([]);
  const [subbaciaSelecionada, setSubbaciaSelecionada] = useState<string>('todas');
  const [alturaMaxCota, setAlturaMaxCota] = useState<number>(30);
  const [inclinacaoMax, setInclinacaoMax] = useState<number>(60);
  const [buscaPalavraChave, setBuscaPalavraChave] = useState<string>('');

  const [limites, setLimites] = useState({ maxAltura: 30, maxInclinacao: 60 });

  useEffect(() => {
    fetch(GCS_GEOJSON_URL)
      .then((res) => res.json())
      .then((geojson) => {
        const features: GeoFeature[] = geojson.features || [];
        setDadosBrutos(features);

        const cats = new Set<string>();
        let maxAlt = 15;
        let maxInc = 45;

        features.forEach((f) => {
          const p = f.properties || {};
          cats.add(p.categoria || 'Não classificado');

          const alt = Number(p.altura_min_acima_do_rio_m);
          if (!isNaN(alt) && alt > maxAlt) maxAlt = Math.ceil(alt);

          const inc = Number(p.Inclinaxao_graus ?? p.inclinacao_graus);
          if (!isNaN(inc) && inc > maxInc) maxInc = Math.ceil(inc);
        });

        setCategoriasAtivas(Array.from(cats));
        setLimites({ maxAltura: maxAlt, maxInclinacao: maxInc });
        setAlturaMaxCota(maxAlt);
        setInclinacaoMax(maxInc);
        setCarregando(false);
      })
      .catch((err) => {
        console.error('Erro ao carregar GeoJSON:', err);
        setCarregando(false);
      });
  }, []);

  const { listaCategorias, mapaCores, listaSubbacias } = useMemo(() => {
    const cats = new Set<string>();
    const bacias = new Set<string>();

    dadosBrutos.forEach((f) => {
