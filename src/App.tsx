import React, { useState, useMemo, useEffect, useRef } from 'react';
import { APIProvider, Map as MapaGoogle, useMap, InfoWindow } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { ScatterplotLayer } from '@deck.gl/layers';
import { Waves, Search, SlidersHorizontal, RotateCcw, MapPin, Layers, Mountain, ArrowUpFromLine } from 'lucide-react';

const GCS_GEOJSON_URL = import.meta.env.VITE_GCS_GEOJSON_URL as string;
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

const PALETA_CORES: [number, number, number][] = [
  [239, 68, 68], [59, 130, 246], [16, 185, 129], [245, 158, 11],
  [139, 92, 246], [236, 72, 153], [6, 182, 212], [249, 115, 22],
];

interface GeoFeature {
  type: string;
  geometry: { type: string; coordinates: [number, number] };
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
    return () => overlay.setMap(null);
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
      getFillColor: (d) => mapaCores[d.properties?.categoria || 'Não classificado'] || [100, 116, 139],
      getLineColor: [255, 255, 255, 210],
      onClick: (info) => { if (info.object) aoClicarPonto(info.object); },
      updateTriggers: { getFillColor: [mapaCores] },
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
      cats.add(f.properties?.categoria || 'Não classificado');
      if (f.properties?.nome_subbacia_n6) bacias.add(f.properties.nome_subbacia_n6);
    });
    const categoriasOrdenadas = Array.from(cats).sort();
    const cores: Record<string, [number, number, number]> = {};
    categoriasOrdenadas.forEach((cat, idx) => {
      cores[cat] = PALETA_CORES[idx % PALETA_CORES.length];
    });
    return { listaCategorias: categoriasOrdenadas, mapaCores: cores, listaSubbacias: Array.from(bacias).sort() };
  }, [dadosBrutos]);

  const dadosFiltrados = useMemo(() => {
    const termo = buscaPalavraChave.trim().toLowerCase();
    const setCats = new Set(categoriasAtivas);
    return dadosBrutos.filter((item) => {
      const p = item.properties || {};
      if (!setCats.has(p.categoria || 'Não classificado')) return false;
      if (subbaciaSelecionada !== 'todas' && p.nome_subbacia_n6 !== subbaciaSelecionada) return false;
      if (Number(p.altura_min_acima_do_rio_m ?? 0) > alturaMaxCota) return false;
      if (Number(p.Inclinaxao_graus ?? p.inclinacao_graus ?? 0) > inclinacaoMax) return false;
      if (termo !== '' && !String(p.descricao_estabelecimento || '').toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [dadosBrutos, categoriasAtivas, subbaciaSelecionada, alturaMaxCota, inclinacaoMax, buscaPalavraChave]);

  const alternarCategoria = (cat: string) => {
    setCategoriasAtivas((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  };

  const resetarFiltros = () => {
    setCategoriasAtivas(listaCategorias);
    setSubbaciaSelecionada('todas');
    setAlturaMaxCota(limites.maxAltura);
    setInclinacaoMax(limites.maxInclinacao);
    setBuscaPalavraChave('');
    setPontoSelecionado(null);
  };

  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <div className="flex flex-col h-screen w-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
        <header className="h-16 bg-slate-900 text-white px-6 flex items-center justify-between shadow-md z-20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600/20 border border-blue-500/30 rounded-lg text-blue-400">
              <Waves className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight leading-tight">
                Simulação de Impactos de Inundações na Bacia do Rio Itajaí
              </h1>
              <p className="text-xs text-slate-400">Monitoramento geoespacial de exposição hidrodinâmica e infraestrutura</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm">
            <div className="text-right">
              <span className="text-slate-400 block text-xs">Registros Filtrados</span>
              <span className="font-semibold text-blue-400 text-base">{dadosFiltrados.length.toLocaleString('pt-BR')}</span>
              <span className="text-slate-500 text-xs"> / {dadosBrutos.length.toLocaleString('pt-BR')}</span>
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
              <button onClick={resetarFiltros} className="text-xs flex items-center gap-1 text-slate-500 hover:text-blue-600 cursor-pointer">
                <RotateCcw className="w-3.5 h-3.5" /> Resetar
              </button>
            </div>

            {carregando ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm font-medium">Carregando malha vetorial...</p>
                <p className="text-xs text-slate-400 mt-1">Processando registros do Cloud Storage</p>
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
                      placeholder="Ex: hospital, escola, ponte, mercado..."
                      className="w-full pl-3 pr-8 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                    />
                    {buscaPalavraChave && (
                      <button onClick={() => setBuscaPalavraChave('')} className="absolute right-2.5 top-2.5 text-xs text-slate-400">✕</button>
                    )}
                  </div>
                </div>

                <div className="p-3.5 bg-blue-50/60 border border-blue-100 rounded-xl">
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <ArrowUpFromLine className="w-3.5 h-3.5 text-blue-600" /> Altura Mín. Acima do Rio (HAND)
                    </label>
                    <span className="text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded-full">até {alturaMaxCota} m</span>
                  </div>
                  <input type="range" min={0} max={limites.maxAltura} step={0.5} value={alturaMaxCota} onChange={(e) => setAlturaMaxCota(Number(e.target.value))} className="w-full accent-blue-600 cursor-pointer" />
                  <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                    <span>0 m (Calha)</span><span>Simular cota</span><span>{limites.maxAltura} m</span>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <Mountain className="w-3.5 h-3.5 text-slate-600" /> Inclinação Máxima do Terreno
                    </label>
                    <span className="text-xs font-semibold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">até {inclinacaoMax}°</span>
                  </div>
                  <input type="range" min={0} max={limites.maxInclinacao} step={1} value={inclinacaoMax} onChange={(e) => setInclinacaoMax(Number(e.target.value))} className="w-full accent-slate-700 cursor-pointer" />
                  <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                    <span>0° (Plano)</span><span>{limites.maxInclinacao}° (Íngreme)</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> Sub-bacia Hidrográfica (Nível 6)
                  </label>
                  <select value={subbaciaSelecionada} onChange={(e) => setSubbaciaSelecionada(e.target.value)} className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg">
                    <option value="todas">Todas as Sub-bacias ({listaSubbacias.length})</option>
                    {listaSubbacias.map((bacia) => <option key={bacia} value={bacia}>{bacia}</option>)}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" /> Categorias ({categoriasAtivas.length}/{listaCategorias.length})
                    </label>
                    <button
                      onClick={() => setCategoriasAtivas(categoriasAtivas.length === listaCategorias.length ? [] : listaCategorias)}
                      className="text-xs text-blue-600 hover:underline cursor-pointer"
                    >
                      {categoriasAtivas.length === listaCategorias.length ? 'Desmarcar todas' : 'Marcar todas'}
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                    {listaCategorias.map((cat) => {
                      const [r, g, b] = mapaCores[cat] || [100, 116, 139];
                      const ativo = categoriasAtivas.includes(cat);
                      return (
                        <label
                          key={cat}
                          onClick={() => alternarCategoria(cat)}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm cursor-pointer select-none ${
                            ativo ? 'bg-white border-slate-200 text-slate-800' : 'bg-slate-50 border-transparent text-slate-400 opacity-60'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <span className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/15" style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }} />
                            <span className="truncate font-medium text-xs">{cat}</span>
                          </div>
                          <input type="checkbox" checked={ativo} onChange={() => {}} className="accent-blue-600 rounded cursor-pointer" />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </aside>

          <main className="flex-1 h-full relative">
            <MapaGoogle defaultCenter={{ lat: -26.9187, lng: -49.066 }} defaultZoom={9} gestureHandling="greedy" mapTypeControl={true} streetViewControl={false}>
              {!carregando && <CamadaBolinhasDeckGL dados={dadosFiltrados} mapaCores={mapaCores} aoClicarPonto={setPontoSelecionado} />}
              {pontoSelecionado && (
                <InfoWindow
                  position={{ lat: pontoSelecionado.geometry.coordinates[1], lng: pontoSelecionado.geometry.coordinates[0] }}
                  onCloseClick={() => setPontoSelecionado(null)}
                >
                  <div className="p-1 max-w-xs text-slate-800 text-xs space-y-1.5">
                    <div className="font-bold text-sm text-slate-900 border-b border-slate-200 pb-1">
                      {pontoSelecionado.properties?.categoria || 'Registro'}
                    </div>
                    {pontoSelecionado.properties?.descricao_estabelecimento && (
                      <p className="text-slate-600 font-medium">{pontoSelecionado.properties.descricao_estabelecimento}</p>
                    )}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 text-[11px]">
                      <span className="text-slate-500">Altura sobre o rio:</span>
                      <span className="font-semibold">{pontoSelecionado.properties?.altura_min_acima_do_rio_m ?? '—'} m</span>
                      <span className="text-slate-500">Inclinação:</span>
                      <span className="font-semibold">{pontoSelecionado.properties?.Inclinaxao_graus ?? pontoSelecionado.properties?.inclinacao_graus ?? '—'}°</span>
                      <span className="text-slate-500">Sub-bacia N6:</span>
                      <span className="font-semibold">{pontoSelecionado.properties?.nome_subbacia_n6 || '—'}</span>
                    </div>
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
// FIM_DO_ARQUIVO
