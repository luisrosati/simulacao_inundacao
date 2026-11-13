import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  APIProvider,
  Map as MapaGoogle,
  useMap,
  useMapsLibrary,
  InfoWindow,
  Marker,
} from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { GeoJsonLayer } from '@deck.gl/layers';
import {
  Waves,
  Search,
  SlidersHorizontal,
  RotateCcw,
  MapPin,
  Layers,
  Mountain,
  ArrowUpFromLine,
  Building2,
  Route,
  Navigation,
  Eye,
  X,
} from 'lucide-react';

const GCS_EMPRESAS_URL = import.meta.env.VITE_GCS_GEOJSON_URL as string;
const GCS_RODOVIAS_URL = (import.meta.env.VITE_GCS_RODOVIAS_URL ||
  import.meta.env.VITE_GCS_DNIT_URL) as string;
const GCS_RIOS_URL = import.meta.env.VITE_GCS_ANA_RIOS_URL as string;
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

const TETO_ALTURA_HAND = 30;

const CORES_FIXAS_RODOVIAS: Record<string, [number, number, number]> = {
  'Rodovia Federal': [234, 88, 12],
  'Rodovia Estadual': [124, 58, 237],
};

const PALETA_CORES_EMPRESAS: [number, number, number][] = [
  [59, 130, 246],
  [16, 185, 129],
  [239, 68, 68],
  [236, 72, 153],
  [6, 182, 212],
  [245, 158, 11],
  [99, 102, 241],
  [132, 204, 22],
];

type AlvoBusca = 'enderecos' | 'estradas' | 'rios';

interface GeoFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: any;
  };
  properties: {
    categoria?: string | number;
    descricao_estabelecimento?: string;
    nome_subbacia_n6?: string | number;
    Inclinaxao_graus?: number;

    tipo_jurisdicao?: string;
    id_trecho_origem?: string;
    codigo_rodovia?: string;
    administracao?: string;
    tipo_superficie?: string;
    condicao_trecho?: string;
    km_inicial?: number;
    km_final?: number;
    extensao_subtrecho_m?: number;
    id_quadradinho?: string;
    subbacia_n6?: string | number;
    cobacia?: string | number;
    cotrecho?: number;
    noriocomp?: string;
    dist_ate_rio_m?: number;
    cota_base_rio_ottobacia_m?: number;
    altitude_min_m?: number;
    altitude_media_m?: number;
    altitude_max_m?: number;
    desnivel_interno_30m_m?: number;
    inclinacao_pct?: number;
    inclinacao_graus?: number;
    classe_risco_deslizamento?: string;
    altura_min_acima_do_rio_m?: number;
    altura_media_acima_do_rio_m?: number;
    altura_max_acima_do_rio_m?: number;
    cota_pista_estimada_m?: number;

    // Propriedades da Hidrografia (ANA)
    cocursodag?: number | string;
    nome_rio?: string;
    descricao_subbacia_n6?: string;
    comprimento_trecho_km?: number;
    distancia_ate_foz_km?: number;
    area_drenagem_local_km2?: number;
    area_drenagem_acumulada_montante_km2?: number;
    ordem_strahler?: number;
    ordem_curso_dagua?: number;

    _camadaOrigem?: 'Estabelecimentos' | 'Malha Rodoviária' | 'Hidrografia (ANA)';
    [key: string]: any;
  };
}

interface SelecaoMapa {
  feature: GeoFeature;
  lat: number;
  lng: number;
}

interface LocalPesquisado {
  lat: number;
  lng: number;
  endereco: string;
}

function normalizarTexto(texto: any): string {
  if (texto === undefined || texto === null) return '';
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extrairPrimeiroPonto(coords: any): [number, number] {
  if (!Array.isArray(coords)) return [-49.066, -26.9187];
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    return [coords[0], coords[1]];
  }
  return extrairPrimeiroPonto(coords[0]);
}

function extrairTodosPontos(coords: any, acumulador: [number, number][] = []): [number, number][] {
  if (!Array.isArray(coords)) return acumulador;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    acumulador.push([coords[0], coords[1]]);
  } else {
    for (const item of coords) {
      extrairTodosPontos(item, acumulador);
    }
  }
  return acumulador;
}

function obterPontoCentralFeature(feature: GeoFeature): [number, number] {
  const pontos = extrairTodosPontos(feature.geometry?.coordinates);
  if (pontos.length === 0) return [-49.066, -26.9187];
  return pontos[Math.floor(pontos.length / 2)];
}

function obterCategoriaItem(p: Record<string, any>): string {
  if (p._camadaOrigem === 'Malha Rodoviária') {
    const jurBruta =
      p.tipo_jurisdicao !== undefined && p.tipo_jurisdicao !== null
        ? String(p.tipo_jurisdicao).trim()
        : '';
    const jur = jurBruta.toLowerCase();
    if (jur.includes('fed')) return 'Rodovia Federal';
    if (jur.includes('est')) return 'Rodovia Estadual';
    if (jurBruta !== '') return `Rodovia (${jurBruta})`;
    return 'Rodovia (Outras)';
  }
  const catBruta =
    p.categoria !== undefined && p.categoria !== null ? String(p.categoria).trim() : '';
  return catBruta !== '' ? catBruta : 'Não classificado';
}

function obterSubbaciaItem(p: Record<string, any>): string {
  const valor = p.nome_subbacia_n6 ?? p.subbacia_n6 ?? p.descricao_subbacia_n6;
  if (valor === undefined || valor === null) return '';
  return String(valor).trim();
}

function BotaoAbrirStreetView({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const streetViewLib = useMapsLibrary('streetView');
  const [msgIndisponivel, setMsgIndisponivel] = useState(false);

  const abrirPanorama = useCallback(() => {
    if (!map || !streetViewLib) return;
    setMsgIndisponivel(false);

    const svService = new streetViewLib.StreetViewService();
    svService.getPanorama(
      { location: { lat, lng }, radius: 80 },
      (data, status) => {
        if (status === 'OK' && data?.location?.latLng) {
          const panorama = map.getStreetView();
          panorama.setPosition(data.location.latLng);
          panorama.setPov({ heading: 0, pitch: 0 });
          panorama.setVisible(true);
        } else {
          setMsgIndisponivel(true);
        }
      }
    );
  }, [map, streetViewLib, lat, lng]);

  return (
    <div className="pt-1.5 mt-1 border-t border-slate-100">
      <button
        type="button"
        onClick={abrirPanorama}
        className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-semibold transition-colors cursor-pointer"
      >
        <Eye className="w-3.5 h-3.5 text-amber-400" />
        Abrir Street View neste ponto
      </button>
      {msgIndisponivel && (
        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1 text-center">
          Sem cobertura do Street View num raio de 80 m deste ponto.
        </p>
      )}
    </div>
  );
}

function BuscaUnificadaMapa({
  alvoBusca,
  aoMudarAlvoBusca,
  dadosRodovias,
  dadosRios,
  aoEncontrarLocal,
  aoLimparLocal,
  aoSelecionarFeatureVetorial,
  possuiMarcador,
}: {
  alvoBusca: AlvoBusca;
  aoMudarAlvoBusca: (novoAlvo: AlvoBusca) => void;
  dadosRodovias: GeoFeature[];
  dadosRios: GeoFeature[];
  aoEncontrarLocal: (local: LocalPesquisado) => void;
  aoLimparLocal: () => void;
  aoSelecionarFeatureVetorial: (sel: SelecaoMapa, tipo: 'estradas' | 'rios') => void;
  possuiMarcador: boolean;
}) {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const geocodingLib = useMapsLibrary('geocoding');

  const [texto, setTexto] = useState('');
  const [sugestoesPlaces, setSugestoesPlaces] = useState<any[]>([]);
  const [aberto, setAberto] = useState(false);
  const tokenRef = useRef<any>(null);
  const reqIdRef = useRef(0);

  const obterToken = () => {
    if (!tokenRef.current && placesLib) {
      const PlacesAny = placesLib as any;
      if (PlacesAny.AutocompleteSessionToken) {
        tokenRef.current = new PlacesAny.AutocompleteSessionToken();
      }
    }
    return tokenRef.current;
  };

  const sugestoesVetoriais = useMemo(() => {
    if (alvoBusca === 'enderecos') return [];
    const termo = normalizarTexto(texto.trim());
    if (termo.length < 2) return [];

    if (alvoBusca === 'estradas') {
      return dadosRodovias
        .filter((f) => {
          const p = f.properties || {};
          return (
            normalizarTexto(p.codigo_rodovia).includes(termo) ||
            normalizarTexto(p.tipo_jurisdicao).includes(termo) ||
            normalizarTexto(p.administracao).includes(termo) ||
            normalizarTexto(p.noriocomp).includes(termo) ||
            normalizarTexto(p.id_trecho_origem).includes(termo) ||
            normalizarTexto(obterSubbaciaItem(p)).includes(termo)
          );
        })
        .slice(0, 20);
    }

    if (alvoBusca === 'rios') {
      return dadosRios
        .filter((f) => {
          const p = f.properties || {};
          return (
            normalizarTexto(p.nome_rio).includes(termo) ||
            normalizarTexto(p.descricao_subbacia_n6).includes(termo) ||
            String(p.cotrecho ?? '').includes(termo) ||
            String(p.cobacia ?? '').includes(termo)
          );
        })
        .slice(0, 20);
    }

    return [];
  }, [alvoBusca, texto, dadosRodovias, dadosRios]);

  const aoDigitar = async (valor: string) => {
    setTexto(valor);
    const consulta = valor.trim();

    if (alvoBusca !== 'enderecos') {
      setSugestoesPlaces([]);
      setAberto(consulta.length >= 2);
      return;
    }

    if (consulta.length < 3 || !placesLib) {
      setSugestoesPlaces([]);
      setAberto(false);
      return;
    }

    const PlacesAny = placesLib as any;
    if (!PlacesAny.AutocompleteSuggestion?.fetchAutocompleteSuggestions) return;

    const reqAtual = ++reqIdRef.current;
    try {
      const boundsItajai = new google.maps.LatLngBounds(
        { lat: -27.9, lng: -50.5 },
        { lat: -26.2, lng: -48.3 }
      );

      const { suggestions } =
        await PlacesAny.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: consulta,
          sessionToken: obterToken(),
          includedRegionCodes: ['br'],
          locationBias: boundsItajai,
          language: 'pt-BR',
        });

      if (reqAtual !== reqIdRef.current) return;
      setSugestoesPlaces(suggestions || []);
      setAberto((suggestions || []).length > 0);
    } catch (err) {
      console.error('Erro ao buscar sugestões Places API (New):', err);
    }
  };

  const selecionarSugestaoPlace = async (sugestao: any) => {
    try {
      const predicao = sugestao.placePrediction;
      if (!predicao) return;

      const place = predicao.toPlace();
      await place.fetchFields({
        fields: ['formattedAddress', 'location', 'viewport'],
      });

      tokenRef.current = null;
      setSugestoesPlaces([]);
      setAberto(false);

      if (!place.location || !map) return;
      const lat = place.location.lat();
      const lng = place.location.lng();
      const label = place.formattedAddress || predicao.text?.toString() || texto;

      if (place.viewport) {
        map.fitBounds(place.viewport);
      } else {
        map.panTo({ lat, lng });
        map.setZoom(16);
      }

      setTexto(label);
      aoEncontrarLocal({ lat, lng, endereco: label });
    } catch (err) {
      console.error('Erro ao carregar detalhes do endereço:', err);
    }
  };

  const selecionarItemVetorial = (feature: GeoFeature) => {
    if (!map) return;
    setAberto(false);

    const pontos = extrairTodosPontos(feature.geometry?.coordinates);
    if (pontos.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      pontos.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
      map.fitBounds(bounds, 70);
    }

    const [lngCentral, latCentral] = obterPontoCentralFeature(feature);
    const p = feature.properties || {};

    if (alvoBusca === 'rios') {
      setTexto(`${p.nome_rio || 'Rio'} (Trecho ${p.cotrecho || ''})`);
      aoSelecionarFeatureVetorial({ feature, lat: latCentral, lng: lngCentral }, 'rios');
    } else if (alvoBusca === 'estradas') {
      const kmTxt =
        p.km_inicial !== undefined ? ` - km ${Number(p.km_inicial).toFixed(1)}` : '';
      setTexto(`${p.codigo_rodovia || 'Rodovia'}${kmTxt}`);
      aoSelecionarFeatureVetorial({ feature, lat: latCentral, lng: lngCentral }, 'estradas');
    }
  };

  const submeterFormulario = (e: React.FormEvent) => {
    e.preventDefault();

    if (alvoBusca !== 'enderecos') {
      if (sugestoesVetoriais.length > 0) {
        selecionarItemVetorial(sugestoesVetoriais[0]);
      }
      return;
    }

    setAberto(false);
    const consulta = texto.trim();
    if (!consulta || !geocodingLib || !map) return;

    const geocoder = new geocodingLib.Geocoder();
    geocoder.geocode({ address: consulta, region: 'BR' }, (results, status) => {
      if (status === 'OK' && results && results[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        const lat = loc.lat();
        const lng = loc.lng();
        if (results[0].geometry.viewport) {
          map.fitBounds(results[0].geometry.viewport);
        } else {
          map.panTo({ lat, lng });
          map.setZoom(16);
        }
        setTexto(results[0].formatted_address);
        aoEncontrarLocal({ lat, lng, endereco: results[0].formatted_address });
      }
    });
  };

  const trocarModo = (novoModo: AlvoBusca) => {
    aoMudarAlvoBusca(novoModo);
    setTexto('');
    setSugestoesPlaces([]);
    setAberto(false);
  };

  const placeholderAtual =
    alvoBusca === 'enderecos'
      ? 'Pesquisar endereço ou município no Google Maps...'
      : alvoBusca === 'estradas'
      ? 'Pesquisar rodovia (ex: BR-470, SC-110, Federal)...'
      : 'Pesquisar rio, sub-bacia ou código do trecho...';

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 w-80 sm:w-[27rem] max-w-[calc(100%-9rem)]">
      <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-md border border-slate-200 p-1.5">
        <form onSubmit={submeterFormulario}>
          <div className="relative flex items-center bg-slate-50 rounded-lg border border-slate-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/40 focus-within:border-blue-500 transition-all">
            {alvoBusca === 'enderecos' && (
              <Navigation className="w-4 h-4 text-blue-600 ml-3 shrink-0" />
            )}
            {alvoBusca === 'estradas' && (
              <Route className="w-4 h-4 text-orange-600 ml-3 shrink-0" />
            )}
            {alvoBusca === 'rios' && <Waves className="w-4 h-4 text-sky-600 ml-3 shrink-0" />}

            <input
              type="text"
              value={texto}
              onChange={(e) => aoDigitar(e.target.value)}
              onFocus={() => {
                if (alvoBusca === 'enderecos' && sugestoesPlaces.length > 0) setAberto(true);
                if (alvoBusca !== 'enderecos' && texto.trim().length >= 2) setAberto(true);
              }}
              placeholder={placeholderAtual}
              className="w-full px-2.5 py-1.5 text-xs sm:text-sm text-slate-800 bg-transparent focus:outline-none"
            />
            {(texto || possuiMarcador) && (
              <button
                type="button"
                onClick={() => {
                  setTexto('');
                  setSugestoesPlaces([]);
                  setAberto(false);
                  aoLimparLocal();
                }}
                className="p-1.5 mr-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                title="Limpar pesquisa"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>

        {/* Radio Buttons para seleção da base de pesquisa */}
        <div className="flex items-center justify-center sm:justify-start gap-4 px-2 pt-1.5 pb-0.5 text-xs text-slate-700 select-none">
          <span className="text-[11px] font-semibold text-slate-400 hidden sm:inline">
            Buscar em:
          </span>

          <label className="flex items-center gap-1.5 cursor-pointer font-medium hover:text-blue-600 transition-colors">
            <input
              type="radio"
              name="alvoBuscaMapa"
              value="enderecos"
              checked={alvoBusca === 'enderecos'}
              onChange={() => trocarModo('enderecos')}
              className="accent-blue-600 cursor-pointer"
            />
            <span>Endereços</span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer font-medium hover:text-orange-600 transition-colors">
            <input
              type="radio"
              name="alvoBuscaMapa"
              value="estradas"
              checked={alvoBusca === 'estradas'}
              onChange={() => trocarModo('estradas')}
              className="accent-orange-600 cursor-pointer"
            />
            <span>Estradas</span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer font-medium hover:text-sky-600 transition-colors">
            <input
              type="radio"
              name="alvoBuscaMapa"
              value="rios"
              checked={alvoBusca === 'rios'}
              onChange={() => trocarModo('rios')}
              className="accent-sky-600 cursor-pointer"
            />
            <span>Rios</span>
          </label>
        </div>
      </div>

      {/* Sugestões Google Places (Endereços) */}
      {aberto && alvoBusca === 'enderecos' && sugestoesPlaces.length > 0 && (
        <ul className="mt-1 bg-white rounded-lg shadow-lg border border-slate-200 max-h-60 overflow-y-auto divide-y divide-slate-100 text-xs text-slate-700">
          {sugestoesPlaces.map((s, idx) => {
            const label = s.placePrediction?.text?.toString() || 'Endereço sugerido';
            return (
              <li
                key={s.placePrediction?.placeId || idx}
                onClick={() => selecionarSugestaoPlace(s)}
                className="px-3 py-2 hover:bg-blue-50 cursor-pointer flex items-center gap-2 transition-colors"
              >
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{label}</span>
              </li>
            );
          })}
          <li className="px-3 py-1 text-[10px] text-right text-slate-400 bg-slate-50 select-none">
            Google Maps
          </li>
        </ul>
      )}

      {/* Sugestões Vetoriais (Estradas ou Rios) */}
      {aberto && alvoBusca !== 'enderecos' && texto.trim().length >= 2 && (
        <ul className="mt-1 bg-white rounded-lg shadow-lg border border-slate-200 max-h-64 overflow-y-auto divide-y divide-slate-100 text-xs text-slate-700">
          {sugestoesVetoriais.length === 0 ? (
            <li className="px-3 py-2.5 text-slate-400 text-center">
              Nenhum trecho encontrado para &ldquo;{texto.trim()}&rdquo;.
            </li>
          ) : (
            sugestoesVetoriais.map((feat, idx) => {
              const p = feat.properties || {};
              if (alvoBusca === 'rios') {
                return (
                  <li
                    key={`rio-${p.cotrecho ?? idx}`}
                    onClick={() => selecionarItemVetorial(feat)}
                    className="px-3 py-2 hover:bg-sky-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 truncate">
                        {p.nome_rio || 'Curso de água'}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-medium shrink-0">
                        Trecho {p.cotrecho} • {p.comprimento_trecho_km ?? '—'} km
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {p.descricao_subbacia_n6 || 'Sub-bacia não informada'} (Strahler{' '}
                      {p.ordem_strahler ?? '—'})
                    </div>
                  </li>
                );
              }

              return (
                <li
                  key={`rod-${p.id_quadradinho ?? p.id_trecho_origem ?? idx}`}
                  onClick={() => selecionarItemVetorial(feat)}
                  className="px-3 py-2 hover:bg-orange-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800 truncate">
                      {p.codigo_rodovia || 'Rodovia'}{' '}
                      {p.km_inicial !== undefined && p.km_final !== undefined
                        ? `(km ${Number(p.km_inicial).toFixed(1)} ao ${Number(p.km_final).toFixed(
                            1
                          )})`
                        : ''}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-medium shrink-0">
                      {p.tipo_jurisdicao || 'Trecho'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    Ref: {p.noriocomp || '—'} • HAND mín:{' '}
                    {p.altura_min_acima_do_rio_m !== undefined
                      ? `${Number(p.altura_min_acima_do_rio_m).toFixed(1)} m`
                      : '—'}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

function BarraIntervaloDuplo({
  min,
  max,
  step,
  valorMin,
  valorMax,
  unidade,
  corHex,
  aoMudar,
}: {
  min: number;
  max: number;
  step: number;
  valorMin: number;
  valorMax: number;
  unidade: string;
  corHex: string;
  aoMudar: (novoMin: number, novoMax: number) => void;
}) {
  const amplitude = Math.max(max - min, 0.0001);
  const pctMin = ((valorMin - min) / amplitude) * 100;
  const pctMax = ((valorMax - min) / amplitude) * 100;

  const classeThumb =
    'pointer-events-none absolute w-full h-1.5 appearance-none bg-transparent ' +
    '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none ' +
    '[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full ' +
    '[&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-700 ' +
    '[&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer ' +
    '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 ' +
    '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 ' +
    '[&::-moz-range-thumb]:border-slate-700 [&::-moz-range-thumb]:cursor-pointer';

  return (
    <div className="pt-1">
      <div className="relative h-6 flex items-center">
        <div className="w-full h-1.5 bg-slate-200 rounded-full relative">
          <div
            className="absolute h-1.5 rounded-full"
            style={{
              left: `${pctMin}%`,
              right: `${100 - pctMax}%`,
              backgroundColor: corHex,
            }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valorMin}
          onChange={(e) => {
            const v = Math.min(Number(e.target.value), valorMax);
            aoMudar(v, valorMax);
          }}
          style={{ zIndex: valorMin > max - amplitude * 0.1 ? 5 : 3 }}
          className={classeThumb}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valorMax}
          onChange={(e) => {
            const v = Math.max(Number(e.target.value), valorMin);
            aoMudar(valorMin, v);
          }}
          style={{ zIndex: 4 }}
          className={classeThumb}
        />
      </div>
      <div className="flex justify-between text-[11px] text-slate-500 mt-0.5 font-medium">
        <span>
          Mín: {valorMin}
          {unidade}
        </span>
        <span>
          Máx: {valorMax}
          {unidade}
        </span>
      </div>
    </div>
  );
}

function CamadasDeckGL({
  dadosEmpresas,
  dadosRodovias,
  dadosRios,
  exibirEmpresas,
  exibirRodovias,
  exibirRios,
  cotrechoSelecionado,
  mapaCores,
  aoSelecionar,
}: {
  dadosEmpresas: GeoFeature[];
  dadosRodovias: GeoFeature[];
  dadosRios: GeoFeature[];
  exibirEmpresas: boolean;
  exibirRodovias: boolean;
  exibirRios: boolean;
  cotrechoSelecionado: number | null;
  mapaCores: Record<string, [number, number, number]>;
  aoSelecionar: (sel: SelecaoMapa | null) => void;
}) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);

  useEffect(() => {
    if (!map) return;
    const overlay = new GoogleMapsOverlay({ layers: [] });
    overlay.setMap(map);
    overlayRef.current = overlay;
    return () => overlay.setMap(null);
  }, [map]);

  useEffect(() => {
    if (!overlayRef.current) return;

    const camadas: any[] = [];

    if (exibirRios && dadosRios.length > 0) {
      camadas.push(
        new GeoJsonLayer({
          id: 'camada-hidrografia-rios',
          data: { type: 'FeatureCollection', features: dadosRios } as any,
          pickable: true,
          stroked: true,
          filled: false,
          lineWidthMinPixels: 1.5,
          lineWidthMaxPixels: 9,
          getLineWidth: (f: any) => {
            const p = f.properties || {};
            const isSel =
              cotrechoSelecionado !== null && Number(p.cotrecho) === cotrechoSelecionado;
            const strahler = Number(p.ordem_strahler || 1);
            return isSel ? Math.max(strahler * 12, 32) : Math.max(strahler * 5, 8);
          },
          getLineColor: (f: any) => {
            const p = f.properties || {};
            const isSel =
              cotrechoSelecionado !== null && Number(p.cotrecho) === cotrechoSelecionado;
            if (isSel) return [245, 158, 11, 255]; // Realce âmbar quando selecionado
            const strahler = Number(p.ordem_strahler || 1);
            return strahler >= 4 ? [2, 132, 199, 235] : [14, 165, 233, 195];
          },
          onClick: (info: any) => {
            if (info.object) {
              const [lngFallback, latFallback] = extrairPrimeiroPonto(
                info.object.geometry?.coordinates
              );
              const lng = info.coordinate ? info.coordinate[0] : lngFallback;
              const lat = info.coordinate ? info.coordinate[1] : latFallback;
              aoSelecionar({ feature: info.object, lat, lng });
            }
          },
          updateTriggers: {
            getLineColor: [cotrechoSelecionado],
            getLineWidth: [cotrechoSelecionado],
          },
        })
      );
    }

    if (exibirRodovias && dadosRodovias.length > 0) {
      camadas.push(
        new GeoJsonLayer({
          id: 'camada-malha-rodoviaria',
          data: { type: 'FeatureCollection', features: dadosRodovias } as any,
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 3,
          lineWidthMaxPixels: 8,
          getLineWidth: 18,
          pointRadiusMinPixels: 4,
          pointRadiusMaxPixels: 12,
          getPointRadius: 22,
          getLineColor: (f: any) => {
            const cat = obterCategoriaItem(f.properties || {});
            const cor = mapaCores[cat] || CORES_FIXAS_RODOVIAS[cat] || [13, 148, 136];
            return [cor[0], cor[1], cor[2], 235];
          },
          getFillColor: (f: any) => {
            const cat = obterCategoriaItem(f.properties || {});
            const cor = mapaCores[cat] || CORES_FIXAS_RODOVIAS[cat] || [13, 148, 136];
            return [cor[0], cor[1], cor[2], 225];
          },
          onClick: (info: any) => {
            if (info.object) {
              const [lngFallback, latFallback] = extrairPrimeiroPonto(
                info.object.geometry?.coordinates
              );
              const lng = info.coordinate ? info.coordinate[0] : lngFallback;
              const lat = info.coordinate ? info.coordinate[1] : latFallback;
              aoSelecionar({ feature: info.object, lat, lng });
            }
          },
          updateTriggers: {
            getLineColor: [mapaCores],
            getFillColor: [mapaCores],
          },
        })
      );
    }

    if (exibirEmpresas && dadosEmpresas.length > 0) {
      camadas.push(
        new GeoJsonLayer({
          id: 'camada-estabelecimentos',
          data: { type: 'FeatureCollection', features: dadosEmpresas } as any,
          pickable: true,
          opacity: 0.85,
          stroked: true,
          filled: true,
          pointRadiusMinPixels: 4,
          pointRadiusMaxPixels: 14,
          lineWidthMinPixels: 1,
          getPointRadius: 25,
          getFillColor: (f: any) => {
            const cat = obterCategoriaItem(f.properties || {});
            return mapaCores[cat] || [100, 116, 139];
          },
          getLineColor: [255, 255, 255, 210],
          onClick: (info: any) => {
            if (info.object) {
              const [lngFallback, latFallback] = extrairPrimeiroPonto(
                info.object.geometry?.coordinates
              );
              const lng = info.coordinate ? info.coordinate[0] : lngFallback;
              const lat = info.coordinate ? info.coordinate[1] : latFallback;
              aoSelecionar({ feature: info.object, lat, lng });
            }
          },
          updateTriggers: {
            getFillColor: [mapaCores],
          },
        })
      );
    }

    overlayRef.current.setProps({ layers: camadas });
  }, [
    dadosEmpresas,
    dadosRodovias,
    dadosRios,
    exibirEmpresas,
    exibirRodovias,
    exibirRios,
    cotrechoSelecionado,
    mapaCores,
    aoSelecionar,
  ]);

  return null;
}

export default function App() {
  const [brutoEmpresas, setBrutoEmpresas] = useState<GeoFeature[]>([]);
  const [brutoRodovias, setBrutoRodovias] = useState<GeoFeature[]>([]);
  const [brutoRios, setBrutoRios] = useState<GeoFeature[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [exibirEmpresas, setExibirEmpresas] = useState(true);
  const [exibirRodovias, setExibirRodovias] = useState(true);
  const [exibirRios, setExibirRios] = useState(true);

  const [alvoBusca, setAlvoBusca] = useState<AlvoBusca>('enderecos');
  const [selecionado, setSelecionado] = useState<SelecaoMapa | null>(null);
  const [localPesquisado, setLocalPesquisado] = useState<LocalPesquisado | null>(null);
  const [exibirInfoEndereco, setExibirInfoEndereco] = useState(false);

  const [categoriasAtivas, setCategoriasAtivas] = useState<string[]>([]);
  const [subbaciaSelecionada, setSubbaciaSelecionada] = useState<string>('todas');

  const [alturaMinCota, setAlturaMinCota] = useState<number>(0);
  const [alturaMaxCota, setAlturaMaxCota] = useState<number>(TETO_ALTURA_HAND);

  const [inclinacaoMin, setInclinacaoMin] = useState<number>(0);
  const [inclinacaoMax, setInclinacaoMax] = useState<number>(60);
  const [tetoInclinacao, setTetoInclinacao] = useState<number>(60);

  const [buscaPalavraChave, setBuscaPalavraChave] = useState<string>('');

  useEffect(() => {
    const buscarCamada = async (
      url: string | undefined,
      nomeCamada: 'Estabelecimentos' | 'Malha Rodoviária' | 'Hidrografia (ANA)'
    ): Promise<GeoFeature[]> => {
      if (!url || !url.startsWith('http')) return [];
      try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const geojson = await res.json();
        const features: GeoFeature[] = geojson.features || [];
        return features.map((f) => ({
          ...f,
          properties: { ...(f.properties || {}), _camadaOrigem: nomeCamada },
        }));
      } catch (err) {
        console.error(`Erro ao carregar ${nomeCamada}:`, err);
        return [];
      }
    };

    Promise.all([
      buscarCamada(GCS_EMPRESAS_URL, 'Estabelecimentos'),
      buscarCamada(GCS_RODOVIAS_URL, 'Malha Rodoviária'),
      buscarCamada(GCS_RIOS_URL, 'Hidrografia (ANA)'),
    ]).then(([emp, rod, rios]) => {
      setBrutoEmpresas(emp);
      setBrutoRodovias(rod);
      setBrutoRios(rios);

      const todas = [...emp, ...rod];
      const cats = new Set<string>();
      let maxInc = 45;

      todas.forEach((f) => {
        const p = f.properties || {};
        cats.add(obterCategoriaItem(p));

        const inc = Number(p.Inclinaxao_graus ?? p.inclinacao_graus);
        if (!isNaN(inc) && inc > maxInc) maxInc = Math.ceil(inc);
      });

      setCategoriasAtivas(Array.from(cats));
      setTetoInclinacao(maxInc);
      setInclinacaoMax(maxInc);
      setCarregando(false);
    });
  }, []);

  const { listaCategorias, mapaCores, listaSubbacias } = useMemo(() => {
    const cats = new Set<string>();
    const bacias = new Set<string>();
    const ativos = [
      ...(exibirEmpresas ? brutoEmpresas : []),
      ...(exibirRodovias ? brutoRodovias : []),
    ];

    ativos.forEach((f) => {
      const p = f.properties || {};
      cats.add(obterCategoriaItem(p));
      const bacia = obterSubbaciaItem(p);
      if (bacia !== '') bacias.add(bacia);
    });

    if (exibirRios) {
      brutoRios.forEach((f) => {
        const p = f.properties || {};
        const bacia = obterSubbaciaItem(p);
        if (bacia !== '') bacias.add(bacia);
      });
    }

    const categoriasOrdenadas = Array.from(cats).sort((a, b) => {
      const strA = String(a);
      const strB = String(b);
      const aRod = strA.startsWith('Rodovia');
      const bRod = strB.startsWith('Rodovia');
      if (aRod && !bRod) return -1;
      if (!aRod && bRod) return 1;
      return strA.localeCompare(strB, 'pt-BR', { numeric: true });
    });

    const cores: Record<string, [number, number, number]> = {};
    let idxEmp = 0;
    categoriasOrdenadas.forEach((cat) => {
      if (CORES_FIXAS_RODOVIAS[cat]) {
        cores[cat] = CORES_FIXAS_RODOVIAS[cat];
      } else if (cat.startsWith('Rodovia')) {
        cores[cat] = [13, 148, 136];
      } else {
        cores[cat] = PALETA_CORES_EMPRESAS[idxEmp % PALETA_CORES_EMPRESAS.length];
        idxEmp += 1;
      }
    });

    return {
      listaCategorias: categoriasOrdenadas,
      mapaCores: cores,
      listaSubbacias: Array.from(bacias).sort((a, b) =>
        String(a).localeCompare(String(b), 'pt-BR', { numeric: true })
      ),
    };
  }, [brutoEmpresas, brutoRodovias, brutoRios, exibirEmpresas, exibirRodovias, exibirRios]);

  const filtrarLista = (lista: GeoFeature[], aplicarBuscaEstabelecimento: boolean) => {
    const termo = buscaPalavraChave.trim().toLowerCase();
    const setCats = new Set(categoriasAtivas);

    return lista.filter((item) => {
      const p = item.properties || {};
      const cat = obterCategoriaItem(p);
      if (!setCats.has(cat)) return false;

      if (subbaciaSelecionada !== 'todas' && obterSubbaciaItem(p) !== subbaciaSelecionada) {
        return false;
      }

      const alturaBruta = Number(p.altura_min_acima_do_rio_m ?? 0);
      const alturaTratada = Math.min(
        TETO_ALTURA_HAND,
        Math.max(0, isNaN(alturaBruta) ? 0 : alturaBruta)
      );
      if (alturaTratada < alturaMinCota || alturaTratada > alturaMaxCota) return false;

      const inclinacao = Number(p.Inclinaxao_graus ?? p.inclinacao_graus ?? 0);
      const incValida = isNaN(inclinacao) ? 0 : inclinacao;
      if (incValida < inclinacaoMin || incValida > inclinacaoMax) return false;

      if (aplicarBuscaEstabelecimento && termo !== '') {
        const desc = String(p.descricao_estabelecimento ?? '').toLowerCase();
        if (!desc.includes(termo)) return false;
      }

      return true;
    });
  };

  const empresasFiltradas = useMemo(
    () => (exibirEmpresas ? filtrarLista(brutoEmpresas, true) : []),
    [
      brutoEmpresas,
      exibirEmpresas,
      categoriasAtivas,
      subbaciaSelecionada,
      alturaMinCota,
      alturaMaxCota,
      inclinacaoMin,
      inclinacaoMax,
      buscaPalavraChave,
    ]
  );

  const rodoviasFiltradas = useMemo(
    () => (exibirRodovias ? filtrarLista(brutoRodovias, false) : []),
    [
      brutoRodovias,
      exibirRodovias,
      categoriasAtivas,
      subbaciaSelecionada,
      alturaMinCota,
      alturaMaxCota,
      inclinacaoMin,
      inclinacaoMax,
    ]
  );

  const riosFiltrados = useMemo(() => {
    if (!exibirRios) return [];
    if (subbaciaSelecionada === 'todas') return brutoRios;
    return brutoRios.filter((f) => {
      const p = f.properties || {};
      return (
        String(p.subbacia_n6 ?? '').trim() === subbaciaSelecionada ||
        String(p.descricao_subbacia_n6 ?? '').trim() === subbaciaSelecionada ||
        obterSubbaciaItem(p) === subbaciaSelecionada
      );
    });
  }, [brutoRios, exibirRios, subbaciaSelecionada]);

  const totalFiltrados =
    empresasFiltradas.length + rodoviasFiltradas.length + riosFiltrados.length;
  const totalAtivosBrutos =
    (exibirEmpresas ? brutoEmpresas.length : 0) +
    (exibirRodovias ? brutoRodovias.length : 0) +
    (exibirRios ? brutoRios.length : 0);

  const cotrechoRioSelecionado =
    selecionado?.feature.properties?._camadaOrigem === 'Hidrografia (ANA)' &&
    selecionado.feature.properties?.cotrecho !== undefined
      ? Number(selecionado.feature.properties.cotrecho)
      : null;

  const alternarCategoria = (cat: string) => {
    setCategoriasAtivas((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const resetarFiltros = () => {
    const todasCats = new Set<string>();
    [...brutoEmpresas, ...brutoRodovias].forEach((f) => {
      todasCats.add(obterCategoriaItem(f.properties || {}));
    });
    setCategoriasAtivas(Array.from(todasCats));
    setSubbaciaSelecionada('todas');
    setAlturaMinCota(0);
    setAlturaMaxCota(TETO_ALTURA_HAND);
    setInclinacaoMin(0);
    setInclinacaoMax(tetoInclinacao);
    setBuscaPalavraChave('');
    setSelecionado(null);
  };

  const formatarNum = (val: any, casas = 2, sufixo = '') => {
    if (val === undefined || val === null || val === '') return '—';
    const num = Number(val);
    if (isNaN(num)) return String(val);
    return `${num.toLocaleString('pt-BR', { maximumFractionDigits: casas })}${sufixo}`;
  };

  const alturaExibidaPonto = (val: any) => {
    const num = Number(val);
    if (isNaN(num)) return '—';
    const fmt = num.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    return num > TETO_ALTURA_HAND ? `30 m (real: ${fmt} m)` : `${fmt} m`;
  };

  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY} language="pt-BR" region="BR">
      <div className="flex flex-col h-screen w-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
        <header className="min-h-16 py-2 bg-slate-900 text-white px-6 flex flex-wrap items-center justify-between gap-4 shadow-md z-20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600/20 border border-blue-500/30 rounded-lg text-blue-400">
              <Waves className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-base md:text-lg font-semibold tracking-tight leading-tight">
                Simulação de Impactos de Inundações na Bacia do Rio Itajaí
              </h1>
              <p className="text-xs text-slate-400 hidden sm:block">
                Monitoramento geoespacial de exposição hidrodinâmica e infraestrutura viária
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-slate-800/90 p-1.5 rounded-xl border border-slate-700">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold px-2 hidden lg:inline">
              Camadas:
            </span>
            <button
              onClick={() => setExibirEmpresas((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                exibirEmpresas
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Estabelecimentos</span>
              <span className="text-[10px] opacity-80">
                ({empresasFiltradas.length.toLocaleString('pt-BR')})
              </span>
            </button>

            <button
              onClick={() => setExibirRodovias((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                exibirRodovias
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Route className="w-3.5 h-3.5" />
              <span>Malha Rodoviária</span>
              <span className="text-[10px] opacity-85">
                ({rodoviasFiltradas.length.toLocaleString('pt-BR')})
              </span>
            </button>

            <button
              onClick={() => setExibirRios((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                exibirRios
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'bg-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Waves className="w-3.5 h-3.5" />
              <span>Rios (ANA)</span>
              <span className="text-[10px] opacity-85">
                ({riosFiltrados.length.toLocaleString('pt-BR')})
              </span>
            </button>
          </div>

          <div className="hidden xl:flex items-center gap-6 text-sm">
            <div className="text-right">
              <span className="text-slate-400 block text-xs">Registros Visíveis</span>
              <span className="font-semibold text-blue-400 text-base">
                {totalFiltrados.toLocaleString('pt-BR')}
              </span>
              <span className="text-slate-500 text-xs">
                {' '}
                / {totalAtivosBrutos.toLocaleString('pt-BR')}
              </span>
            </div>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden relative">
          <aside className="w-96 bg-white border-r border-slate-200 flex flex-col z-10 shadow-sm shrink-0">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-slate-700">
                <SlidersHorizontal className="w-4 h-4 text-blue-600" />
                <span>Parâmetros de Filtragem</span>
              </div>
              <button
                onClick={resetarFiltros}
                className="text-xs flex items-center gap-1 text-slate-500 hover:text-blue-600 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Resetar
              </button>
            </div>

            {carregando ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm font-medium">Carregando camadas vetoriais...</p>
                <p className="text-xs text-slate-400 mt-1">Processando GeoJSON do Cloud Storage</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5" /> Descrição do Estabelecimento
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={buscaPalavraChave}
                      onChange={(e) => setBuscaPalavraChave(e.target.value)}
                      placeholder="Ex: hospital, escola, supermercado, farmácia..."
                      className="w-full pl-3 pr-8 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                    />
                    {buscaPalavraChave && (
                      <button
                        onClick={() => setBuscaPalavraChave('')}
                        className="absolute right-2.5 top-2.5 text-xs text-slate-400"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {(exibirRodovias || exibirRios) && (
                  <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
                    {exibirRodovias && (
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-600">Jurisdição Viária:</span>
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1.5 font-medium text-slate-700">
                            <span className="w-4 h-1.5 rounded-full bg-orange-600 inline-block" />
                            Federal
                          </span>
                          <span className="flex items-center gap-1.5 font-medium text-slate-700">
                            <span className="w-4 h-1.5 rounded-full bg-violet-600 inline-block" />
                            Estadual
                          </span>
                        </div>
                      </div>
                    )}
                    {exibirRios && (
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-600">Hidrografia ANA:</span>
                        <span className="flex items-center gap-1.5 font-medium text-slate-700">
                          <span className="w-4 h-1.5 rounded-full bg-sky-600 inline-block" />
                          Cursos de Água (BHO)
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="p-3.5 bg-blue-50/60 border border-blue-100 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <ArrowUpFromLine className="w-3.5 h-3.5 text-blue-600" /> Altura Acima do Rio (HAND)
                    </label>
                    <span className="text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">
                      {alturaMinCota} m a{' '}
                      {alturaMaxCota === TETO_ALTURA_HAND ? '30+ m' : `${alturaMaxCota} m`}
                    </span>
                  </div>
                  <BarraIntervaloDuplo
                    min={0}
                    max={TETO_ALTURA_HAND}
                    step={0.5}
                    valorMin={alturaMinCota}
                    valorMax={alturaMaxCota}
                    unidade=" m"
                    corHex="#2563eb"
                    aoMudar={(novoMin, novoMax) => {
                      setAlturaMinCota(novoMin);
                      setAlturaMaxCota(novoMax);
                    }}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Valores superiores a 30 m são agrupados em 30 m.
                  </p>
                </div>

                <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <Mountain className="w-3.5 h-3.5 text-slate-600" /> Inclinação do Terreno
                    </label>
                    <span className="text-xs font-semibold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                      {inclinacaoMin}° a {inclinacaoMax}°
                    </span>
                  </div>
                  <BarraIntervaloDuplo
                    min={0}
                    max={tetoInclinacao}
                    step={1}
                    valorMin={inclinacaoMin}
                    valorMax={inclinacaoMax}
                    unidade="°"
                    corHex="#334155"
                    aoMudar={(novoMin, novoMax) => {
                      setInclinacaoMin(novoMin);
                      setInclinacaoMax(novoMax);
                    }}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> Sub-bacia Hidrográfica (Nível 6)
                  </label>
                  <select
                    value={subbaciaSelecionada}
                    onChange={(e) => setSubbaciaSelecionada(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
                  >
                    <option value="todas">Todas as Sub-bacias ({listaSubbacias.length})</option>
                    {listaSubbacias.map((bacia) => (
                      <option key={bacia} value={bacia}>
                        {bacia}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" /> Categorias e Jurisdições (
                      {listaCategorias.filter((c) => categoriasAtivas.includes(c)).length}/
                      {listaCategorias.length})
                    </label>
                    <button
                      onClick={() =>
                        setCategoriasAtivas(
                          categoriasAtivas.length >= listaCategorias.length ? [] : listaCategorias
                        )
                      }
                      className="text-xs text-blue-600 hover:underline cursor-pointer"
                    >
                      {categoriasAtivas.length >= listaCategorias.length
                        ? 'Desmarcar todas'
                        : 'Marcar todas'}
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                    {listaCategorias.map((cat) => {
                      const [r, g, b] = mapaCores[cat] || [100, 116, 139];
                      const ativo = categoriasAtivas.includes(cat);
                      const ehRodovia = cat.startsWith('Rodovia');
                      return (
                        <label
                          key={cat}
                          onClick={() => alternarCategoria(cat)}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm cursor-pointer select-none ${
                            ativo
                              ? 'bg-white border-slate-200 text-slate-800'
                              : 'bg-slate-50 border-transparent text-slate-400 opacity-60'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <span
                              className={
                                ehRodovia
                                  ? 'w-4 h-1.5 rounded-full shrink-0'
                                  : 'w-3.5 h-3.5 rounded-full shrink-0 border border-black/15'
                              }
                              style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
                            />
                            <span className="truncate font-medium text-xs">{cat}</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={ativo}
                            onChange={() => {}}
                            className="accent-blue-600 rounded cursor-pointer"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </aside>

          <main className="flex-1 h-full relative">
            <MapaGoogle
              defaultCenter={{ lat: -26.9187, lng: -49.066 }}
              defaultZoom={9}
              gestureHandling="greedy"
              mapTypeControl={true}
              streetViewControl={true}
              fullscreenControl={true}
            >
              <BuscaUnificadaMapa
                alvoBusca={alvoBusca}
                aoMudarAlvoBusca={(novoAlvo) => {
                  setAlvoBusca(novoAlvo);
                  if (novoAlvo === 'rios') setExibirRios(true);
                  if (novoAlvo === 'estradas') setExibirRodovias(true);
                }}
                dadosRodovias={brutoRodovias}
                dadosRios={brutoRios}
                possuiMarcador={Boolean(localPesquisado)}
                aoEncontrarLocal={(loc) => {
                  setSelecionado(null);
                  setLocalPesquisado(loc);
                  setExibirInfoEndereco(true);
                }}
                aoLimparLocal={() => {
                  setLocalPesquisado(null);
                  setExibirInfoEndereco(false);
                }}
                aoSelecionarFeatureVetorial={(sel, tipo) => {
                  setLocalPesquisado(null);
                  setExibirInfoEndereco(false);
                  if (tipo === 'rios') setExibirRios(true);
                  if (tipo === 'estradas') setExibirRodovias(true);
                  setSelecionado(sel);
                }}
              />

              {localPesquisado && (
                <Marker
                  position={{ lat: localPesquisado.lat, lng: localPesquisado.lng }}
                  onClick={() => setExibirInfoEndereco(true)}
                />
              )}

              {localPesquisado && exibirInfoEndereco && (
                <InfoWindow
                  position={{ lat: localPesquisado.lat, lng: localPesquisado.lng }}
                  onCloseClick={() => setExibirInfoEndereco(false)}
                >
                  <div className="p-1 max-w-xs text-xs text-slate-800">
                    <div className="font-bold text-slate-900 mb-0.5">Endereço Pesquisado</div>
                    <p className="text-slate-600">{localPesquisado.endereco}</p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {localPesquisado.lat.toFixed(5)}, {localPesquisado.lng.toFixed(5)}
                    </p>
                    <BotaoAbrirStreetView lat={localPesquisado.lat} lng={localPesquisado.lng} />
                  </div>
                </InfoWindow>
              )}

              {!carregando && (
                <CamadasDeckGL
                  dadosEmpresas={empresasFiltradas}
                  dadosRodovias={rodoviasFiltradas}
                  dadosRios={riosFiltrados}
                  exibirEmpresas={exibirEmpresas}
                  exibirRodovias={exibirRodovias}
                  exibirRios={exibirRios}
                  cotrechoSelecionado={cotrechoRioSelecionado}
                  mapaCores={mapaCores}
                  aoSelecionar={setSelecionado}
                />
              )}

              {selecionado && (
                <InfoWindow
                  position={{ lat: selecionado.lat, lng: selecionado.lng }}
                  onCloseClick={() => setSelecionado(null)}
                >
                  <div className="p-1 max-w-xs max-h-80 overflow-y-auto text-slate-800 text-xs space-y-1.5">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-1">
                      <span className="font-bold text-sm text-slate-900">
                        {selecionado.feature.properties?._camadaOrigem === 'Hidrografia (ANA)'
                          ? String(selecionado.feature.properties?.nome_rio || 'Curso de Água')
                          : selecionado.feature.properties?._camadaOrigem === 'Malha Rodoviária'
                          ? String(
                              selecionado.feature.properties?.codigo_rodovia || 'Trecho Rodoviário'
                            )
                          : obterCategoriaItem(selecionado.feature.properties || {})}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                          selecionado.feature.properties?._camadaOrigem === 'Hidrografia (ANA)'
                            ? 'bg-sky-100 text-sky-800'
                            : selecionado.feature.properties?._camadaOrigem === 'Malha Rodoviária'
                            ? obterCategoriaItem(selecionado.feature.properties) ===
                              'Rodovia Federal'
                              ? 'bg-orange-100 text-orange-800'
                              : 'bg-violet-100 text-violet-800'
                            : 'bg-blue-50 text-blue-700'
                        }`}
                      >
                        {selecionado.feature.properties?._camadaOrigem === 'Hidrografia (ANA)'
                          ? 'Hidrografia ANA'
                          : selecionado.feature.properties?._camadaOrigem === 'Malha Rodoviária'
                          ? String(selecionado.feature.properties?.tipo_jurisdicao || 'Rodovia')
                          : 'Estabelecimento'}
                      </span>
                    </div>

                    {selecionado.feature.properties?._camadaOrigem === 'Hidrografia (ANA)' ? (
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-0.5 text-[11px]">
                        <span className="text-slate-500">Cód. Trecho (BHO):</span>
                        <span className="font-semibold">
                          {selecionado.feature.properties?.cotrecho ?? '—'}
                        </span>

                        <span className="text-slate-500">Ottobacia:</span>
                        <span className="font-semibold">
                          {selecionado.feature.properties?.cobacia ?? '—'}
                        </span>

                        <span className="text-slate-500">Sub-bacia N6:</span>
                        <span className="font-semibold">
                          {selecionado.feature.properties?.descricao_subbacia_n6 ||
                            obterSubbaciaItem(selecionado.feature.properties || {}) ||
                            '—'}
                        </span>

                        <span className="text-slate-500">Extensão trecho:</span>
                        <span className="font-semibold">
                          {formatarNum(
                            selecionado.feature.properties?.comprimento_trecho_km,
                            2,
                            ' km'
                          )}
                        </span>

                        <span className="text-slate-500">Distância até foz:</span>
                        <span className="font-semibold">
                          {formatarNum(
                            selecionado.feature.properties?.distancia_ate_foz_km,
                            2,
                            ' km'
                          )}
                        </span>

                        <span className="text-slate-500">Área dren. local:</span>
                        <span className="font-semibold">
                          {formatarNum(
                            selecionado.feature.properties?.area_drenagem_local_km2,
                            2,
                            ' km²'
                          )}
                        </span>

                        <span className="text-slate-500">Área acum. montante:</span>
                        <span className="font-semibold">
                          {formatarNum(
                            selecionado.feature.properties?.area_drenagem_acumulada_montante_km2,
                            2,
                            ' km²'
                          )}
                        </span>

                        <span className="text-slate-500">Ordem de Strahler:</span>
                        <span className="font-semibold">
                          {selecionado.feature.properties?.ordem_strahler ?? '—'}
                        </span>
                      </div>
                    ) : (
                      <>
                        {selecionado.feature.properties?.descricao_estabelecimento && (
                          <p className="text-slate-600 font-medium">
                            {String(selecionado.feature.properties.descricao_estabelecimento)}
                          </p>
                        )}

                        {selecionado.feature.properties?._camadaOrigem === 'Malha Rodoviária' && (
                          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 py-1.5 border-b border-slate-100 text-[11px]">
                            <span className="text-slate-500">Administração:</span>
                            <span className="font-semibold">
                              {selecionado.feature.properties?.administracao || '—'}
                            </span>

                            <span className="text-slate-500">Superfície:</span>
                            <span className="font-semibold">
                              {selecionado.feature.properties?.tipo_superficie || '—'}
                            </span>

                            <span className="text-slate-500">Condição:</span>
                            <span className="font-semibold">
                              {selecionado.feature.properties?.condicao_trecho || '—'}
                            </span>

                            <span className="text-slate-500">Quilometragem:</span>
                            <span className="font-semibold">
                              km {formatarNum(selecionado.feature.properties?.km_inicial, 2)} ao km{' '}
                              {formatarNum(selecionado.feature.properties?.km_final, 2)}
                            </span>

                            <span className="text-slate-500">Extensão subtrecho:</span>
                            <span className="font-semibold">
                              {formatarNum(
                                selecionado.feature.properties?.extensao_subtrecho_m,
                                1,
                                ' m'
                              )}
                            </span>

                            <span className="text-slate-500">Rio de referência:</span>
                            <span className="font-semibold">
                              {selecionado.feature.properties?.noriocomp || '—'} (
                              {formatarNum(selecionado.feature.properties?.dist_ate_rio_m, 0, ' m')}
                              )
                            </span>

                            <span className="text-slate-500">Cota estimada pista:</span>
                            <span className="font-semibold">
                              {formatarNum(
                                selecionado.feature.properties?.cota_pista_estimada_m,
                                2,
                                ' m'
                              )}
                            </span>

                            <span className="text-slate-500">Risco deslizamento:</span>
                            <span className="font-semibold">
                              {selecionado.feature.properties?.classe_risco_deslizamento || '—'}
                            </span>
                          </div>
                        )}

                        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-0.5 text-[11px]">
                          <span className="text-slate-500">HAND mín. sobre rio:</span>
                          <span className="font-semibold">
                            {alturaExibidaPonto(
                              selecionado.feature.properties?.altura_min_acima_do_rio_m
                            )}
                          </span>

                          {selecionado.feature.properties?._camadaOrigem === 'Malha Rodoviária' && (
                            <>
                              <span className="text-slate-500">HAND méd. / máx.:</span>
                              <span className="font-semibold">
                                {formatarNum(
                                  selecionado.feature.properties?.altura_media_acima_do_rio_m,
                                  2,
                                  ' m'
                                )}{' '}
                                /{' '}
                                {formatarNum(
                                  selecionado.feature.properties?.altura_max_acima_do_rio_m,
                                  2,
                                  ' m'
                                )}
                              </span>
                            </>
                          )}

                          <span className="text-slate-500">Inclinação:</span>
                          <span className="font-semibold">
                            {formatarNum(
                              selecionado.feature.properties?.Inclinaxao_graus ??
                                selecionado.feature.properties?.inclinacao_graus,
                              1,
                              '°'
                            )}
                            {selecionado.feature.properties?.inclinacao_pct !== undefined &&
                              ` (${formatarNum(
                                selecionado.feature.properties.inclinacao_pct,
                                1,
                                '%'
                              )})`}
                          </span>

                          <span className="text-slate-500">Sub-bacia N6:</span>
                          <span className="font-semibold">
                            {obterSubbaciaItem(selecionado.feature.properties || {}) || '—'}
                          </span>
                        </div>
                      </>
                    )}

                    <BotaoAbrirStreetView lat={selecionado.lat} lng={selecionado.lng} />
                  </div>
                </InfoWindow>
              )}
            </MapaGoogle>
          </main>
        </div>
      </div>
    </APIProvider>
  );
}
