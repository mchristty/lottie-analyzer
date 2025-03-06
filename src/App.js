import React, { useState } from "react";
// import clsx from 'clsx';
// import { AiOutlineCopy } from "react-icons/ai";

////////////////////////////////////////////////////////
// 0) Учтены все пожелания:
// - Имя файла в шапке
// - Группировка анимаций по (layer, startFrame, endFrame)
// - Выделение общей скорости, если совпадает у всех параметров
// - Позиция скругляется до целых пикселей
// - Цвет: rgba(...) + (#hex)
// - Объединение безымянных слоёв с родительским именем
// - Современные тени (2025ish style)
// - Иконки копирования
////////////////////////////////////////////////////////

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch((err) => {
    console.error("Failed to copy:", err);
  });
}

// Оптимизированный box-shadow под тренды 2025
// Но используем inline классы для примера
// (в реальном проекте - Tailwind config/themes)

////////////////////////////////////////////////////////
// Сбор всех слоёв (включая 'assets')
////////////////////////////////////////////////////////
function collectAllLayers(data) {
  const allLayers = [];
  if (data.layers) {
    allLayers.push(...data.layers);
  }
  if (Array.isArray(data.assets)) {
    for (const asset of data.assets) {
      if (Array.isArray(asset.layers)) {
        allLayers.push(...asset.layers);
      }
    }
  }
  return allLayers;
}

////////////////////////////////////////////////////////
// climbName - поднимаемся по родителям, ищем first non-empty name
////////////////////////////////////////////////////////
function climbName(layer, layersById, visited = new Set()) {
  if (!layer) return "(no name)";
  if (layer.nm && layer.nm.trim().length > 0) {
    return layer.nm;
  }
  if (layer.parent && !visited.has(layer.parent) && layersById[layer.parent]) {
    visited.add(layer.parent);
    return climbName(layersById[layer.parent], layersById, visited);
  }
  return "(no name)";
}

function getLayerName(layer, layersById) {
  return climbName(layer, layersById);
}

function framesToMs(frames, fr) {
  return Math.round((frames / fr) * 1000);
}

////////////////////////////////////////////////////////
// Конвертируем в #RRGGBB(AA) (если alpha <1)
////////////////////////////////////////////////////////
function toHex(r, g, b, a) {
  const rr = r.toString(16).padStart(2, "0");
  const gg = g.toString(16).padStart(2, "0");
  const bb = b.toString(16).padStart(2, "0");
  if (a === undefined || a >= 1) {
    return `#${rr}${gg}${bb}`;
  } else {
    const aa = Math.round(a * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${rr}${gg}${bb}${aa}`;
  }
}

////////////////////////////////////////////////////////
// Формируем строку 'rgba(r,g,b,a) / #rrggbb'
////////////////////////////////////////////////////////
function formatColor(values) {
  const r = Math.round(values[0] * 255);
  const g = Math.round(values[1] * 255);
  const b = Math.round(values[2] * 255);
  let a = 1;
  if (values.length === 4) {
    a = values[3];
  }
  const alphaStr = a.toFixed(2).replace(/\\.00$/, "");
  const hexStr = toHex(r, g, b, a);
  return `rgba(${r}, ${g}, ${b}, ${alphaStr}) / ${hexStr}`;
}

////////////////////////////////////////////////////////
// Округляем и форматируем параметры:
////////////////////////////////////////////////////////
function formatValue(values, paramName) {
  if (paramName === "Color" && values.length >= 3) {
    // RGBA + HEX
    return [formatColor(values)];
  }

  return values.map((val) => {
    if (paramName === "Position") {
      // целые
      return String(Math.round(val));
    }
    if (["Scale", "Opacity"].includes(paramName)) {
      return `${Math.round(val)}%`;
    }
    if (paramName === "Rotation") {
      return `${Math.round(val)}°`;
    }
    if (["CornerRadius", "Blur", "DropShadow"].includes(paramName)) {
      return `${Math.round(val)}px`;
    }
    // Default
    return String(Math.round(val));
  });
}

////////////////////////////////////////////////////////
// Извлечение экшенов (ключевые кадры) для одного param
////////////////////////////////////////////////////////
function extractActions(keyframeData, paramName, layerName, fr) {
  const actions = [];
  const keyframes = keyframeData.k;
  if (!Array.isArray(keyframes)) {
    return actions;
  }

  for (let i = 0; i < keyframes.length - 1; i++) {
    const startKF = keyframes[i];
    const endKF = keyframes[i + 1];

    const startFrame = startKF.t;
    const endFrame = endKF.t;
    const startValue = startKF.s;
    const endValue = endKF.s;

    const inSpeed = [...(startKF.i?.x ?? []), ...(startKF.i?.y ?? [])].map(
      (v) => Number(v.toFixed(2))
    );

    const outSpeed = [...(startKF.o?.x ?? []), ...(startKF.o?.y ?? [])].map(
      (v) => Number(v.toFixed(2))
    );

    if (JSON.stringify(startValue) === JSON.stringify(endValue)) {
      continue;
    }

    let moveValue = null;
    if (
      paramName.toLowerCase() === "position" &&
      Array.isArray(startValue) &&
      Array.isArray(endValue) &&
      startValue.length >= 2 &&
      endValue.length >= 2
    ) {
      const dx = Math.round(endValue[0] - startValue[0]);
      const dy = Math.round(endValue[1] - startValue[1]);
      moveValue = [`x${dx}`, `y${dy}`];
    }

    actions.push({
      layer: layerName,
      param: paramName,
      startFrame,
      endFrame,
      duration: Math.round(((endFrame - startFrame) / fr) * 1000),
      startValue: formatValue(startValue, paramName),
      endValue: formatValue(endValue, paramName),
      inSpeed,
      outSpeed,
      move: moveValue,
    });
  }

  return actions;
}

////////////////////////////////////////////////////////
// processTransformKeyframes, processEffects, processShapes
////////////////////////////////////////////////////////
function processTransformKeyframes(ks, layerName, fr) {
  const actions = [];
  if (!ks) return actions;

  if (ks.p?.a === 1) {
    actions.push(...extractActions(ks.p, "Position", layerName, fr));
  }
  if (ks.s?.a === 1) {
    actions.push(...extractActions(ks.s, "Scale", layerName, fr));
  }
  if (ks.o?.a === 1) {
    actions.push(...extractActions(ks.o, "Opacity", layerName, fr));
  }
  if (ks.r?.a === 1) {
    actions.push(...extractActions(ks.r, "Rotation", layerName, fr));
  }

  if (ks.rc?.a === 1) {
    actions.push(...extractActions(ks.rc, "CornerRadius", layerName, fr));
  } else if (ks.cr?.a === 1) {
    actions.push(...extractActions(ks.cr, "CornerRadius", layerName, fr));
  }

  return actions;
}

function processEffects(layer, layerName, fr) {
  const actions = [];
  const { ef } = layer;
  if (!Array.isArray(ef)) return actions;

  ef.forEach((eff) => {
    const effName = eff.nm || "";
    const effVal = eff.v || {};
    if (effVal.a === 1 && Array.isArray(effVal.k)) {
      let paramName = "";
      if (
        effName.toLowerCase().includes("blur") ||
        effName.toLowerCase().includes("gaussian")
      ) {
        paramName = "Blur";
      } else if (effName.toLowerCase().includes("shadow")) {
        paramName = "DropShadow";
      }
      if (paramName) {
        actions.push(...extractActions(effVal, paramName, layerName, fr));
      }
    }
  });

  return actions;
}

function processShapes(shapes, layerName, fr) {
  const actions = [];
  if (!Array.isArray(shapes)) return actions;

  for (const shapeItem of shapes) {
    const shapeType = shapeItem.ty;
    if (shapeType === "gr" && Array.isArray(shapeItem.it)) {
      actions.push(...processShapes(shapeItem.it, layerName, fr));
    } else if (shapeType === "tr") {
      const { p, s, r, o } = shapeItem;
      if (p?.a === 1)
        actions.push(...extractActions(p, "Position", layerName, fr));
      if (s?.a === 1)
        actions.push(...extractActions(s, "Scale", layerName, fr));
      if (r?.a === 1)
        actions.push(...extractActions(r, "Rotation", layerName, fr));
      if (o?.a === 1)
        actions.push(...extractActions(o, "Opacity", layerName, fr));
    } else if (shapeType === "rc") {
      if (shapeItem.r?.a === 1) {
        actions.push(
          ...extractActions(shapeItem.r, "CornerRadius", layerName, fr)
        );
      }
    } else if (shapeType === "fl") {
      if (shapeItem.c?.a === 1) {
        actions.push(...extractActions(shapeItem.c, "Color", layerName, fr));
      }
      if (shapeItem.o?.a === 1) {
        actions.push(...extractActions(shapeItem.o, "Opacity", layerName, fr));
      }
    }
  }

  return actions;
}

////////////////////////////////////////////////////////
// Основной анализ
////////////////////////////////////////////////////////
function analyzeLottie(jsonData) {
  const fr = jsonData.fr || 100;
  const allLayers = collectAllLayers(jsonData);

  // Подготовим словарь {ind -> layer}
  const layersById = {};
  allLayers.forEach((ly) => {
    if (typeof ly.ind !== "undefined") {
      layersById[ly.ind] = ly;
    }
  });

  const rawActions = [];

  for (const layer of allLayers) {
    const resolvedName = getLayerName(layer, layersById);

    // transform
    if (layer.ks) {
      rawActions.push(...processTransformKeyframes(layer.ks, resolvedName, fr));
    }
    // effects
    if (layer.ef) {
      rawActions.push(...processEffects(layer, resolvedName, fr));
    }
    // shape
    if (
      (layer.ty === 4 || layer.ty === "shape") &&
      Array.isArray(layer.shapes)
    ) {
      rawActions.push(...processShapes(layer.shapes, resolvedName, fr));
    }
  }

  // Отсортируем
  rawActions.sort((a, b) => {
    if (a.startFrame !== b.startFrame) {
      return a.startFrame - b.startFrame;
    }
    return a.layer.localeCompare(b.layer);
  });

  // Группировка по layer + промежутку кадров
  const groupedMap = {};
  for (const action of rawActions) {
    const key = `${action.layer}__${action.startFrame}__${action.endFrame}`;
    if (!groupedMap[key]) {
      groupedMap[key] = {
        layer: action.layer,
        startFrame: action.startFrame,
        endFrame: action.endFrame,
        duration: action.duration,
        params: [],
      };
    }
    groupedMap[key].params.push({
      param: action.param,
      startValue: action.startValue,
      endValue: action.endValue,
      inSpeed: action.inSpeed,
      outSpeed: action.outSpeed,
      move: action.move,
    });
  }

  const intervals = Object.values(groupedMap);
  intervals.sort((a, b) => a.startFrame - b.startFrame);

  return {
    frameRate: fr,
    totalLayers: allLayers.length,
    animatedLayers: new Set(rawActions.map((a) => a.layer)).size,
    intervals,
  };
}

////////////////////////////////////////////////////////
// React Компонент
////////////////////////////////////////////////////////
export default function LottieAnalyzerApp() {
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState("");

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".json")) {
      setError("Please upload a valid JSON file.");
      return;
    }
    setError(null);
    setFileName(file.name);

    try {
      const text = await file.text();
      const jsonData = JSON.parse(text);
      const result = analyzeLottie(jsonData);
      setAnalysisResult(result);
    } catch (err) {
      console.error(err);
      setError("Failed to parse the Lottie JSON file.");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      handleFileChange({ target: { files: [file] } });
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  return (
    <div className="container" onDrop={handleDrop} onDragOver={handleDragOver}>
      <div className="content">
        <h1 className="title">Lottie JSON Analyzer</h1>
        {fileName && (
          <p className="file-name">
            File: <b>{fileName}</b>
          </p>
        )}

        <div className="drop-zone">
          <p className="drop-text">Drag & Drop a JSON file here</p>
          <p className="drop-text">or</p>
          <label className="file-label">
            Select a JSON File
            <input
              type="file"
              accept=".json"
              className="file-input"
              onChange={handleFileChange}
            />
          </label>
        </div>

        {error && <div className="error-message">{error}</div>}

        {analysisResult && (
          <div className="analysis-result">
            <h2 className="result-title">Analysis Results</h2>
            <div className="result-grid">
              <div className="result-item">
                Frame rate: <b>{analysisResult.frameRate}</b>
              </div>
              <div className="result-item">
                Total layers: <b>{analysisResult.totalLayers}</b>
              </div>
              <div className="result-item">
                Animated layers: <b>{analysisResult.animatedLayers}</b>
              </div>
              <div className="result-item">
                Intervals found: <b>{analysisResult.intervals.length}</b>
              </div>
            </div>
            {analysisResult.intervals.length === 0 ? (
              <p className="no-animation">No animated parameters found.</p>
            ) : (
              <div className="interval-list">
                {analysisResult.intervals.map((group, idx) => {
                  const allInSpeeds = group.params.map((p) =>
                    JSON.stringify(p.inSpeed)
                  );
                  const allOutSpeeds = group.params.map((p) =>
                    JSON.stringify(p.outSpeed)
                  );
                  const uniqueIn = new Set(allInSpeeds);
                  const uniqueOut = new Set(allOutSpeeds);

                  let globalInSpeed = null;
                  let globalOutSpeed = null;
                  if (uniqueIn.size === 1) {
                    globalInSpeed = group.params[0].inSpeed;
                  }
                  if (uniqueOut.size === 1) {
                    globalOutSpeed = group.params[0].outSpeed;
                  }

                  let copyText = `Frames: ${group.startFrame} -> ${group.endFrame}\\nDuration(ms): ${group.duration}\\n`;

                  copyText += group.params
                    .map((p) => {
                      return `\\n[Param] ${
                        p.param
                      }\\n  Start: ${p.startValue.join(
                        ", "
                      )}\\n  End: ${p.endValue.join(
                        ", "
                      )}\\n  SpeedIn: [${p.inSpeed.join(
                        ", "
                      )}]\\n  SpeedOut: [${p.outSpeed.join(", ")}]\\n  Move: ${
                        p.move ? p.move.join(", ") : "—"
                      }`;
                    })
                    .join("\\n");

                  return (
                    <div key={idx} className="interval-item">
                      <div className="interval-header">
                        <div className="interval-title">
                          #{idx + 1} &mdash; {group.layer}
                        </div>
                        <button
                          className="copy-button"
                          onClick={() => copyToClipboard(copyText)}
                        >
                          <svg
                            id="closedLoans"
                            width="100%"
                            height="100%"
                            viewBox="0 0 13 9"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M11.5 1L4.5 8L1 4.5"
                              stroke="#525252"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>

                      <div className="interval-details">
                        <div className="detail-item">
                          Frames:{" "}
                          <b>
                            {group.startFrame} - {group.endFrame}
                          </b>
                        </div>
                        <div className="detail-item">
                          Duration: <b>{group.duration}ms</b>
                        </div>
                        {globalOutSpeed && (
                          <div className="detail-item">
                            Speed In: <b>[{globalOutSpeed.join(", ")}]</b>
                          </div>
                        )}
                        {globalInSpeed && (
                          <div className="detail-item">
                            Speed Out: <b>[{globalInSpeed.join(", ")}]</b>
                          </div>
                        )}
                      </div>

                      <div className="params-grid">
                        {group.params.map((paramObj, pIdx) => {
                          const showIn =
                            !globalInSpeed ||
                            JSON.stringify(paramObj.inSpeed) !==
                              JSON.stringify(globalInSpeed);
                          const showOut =
                            !globalOutSpeed ||
                            JSON.stringify(paramObj.outSpeed) !==
                              JSON.stringify(globalOutSpeed);

                          const paramCopyText = `Param: ${
                            paramObj.param
                          }\\nStart: ${paramObj.startValue.join(
                            ", "
                          )}\\nEnd: ${paramObj.endValue.join(
                            ", "
                          )}\\nSpeedIn: [${paramObj.inSpeed.join(
                            ", "
                          )}]\\nSpeedOut: [${paramObj.outSpeed.join(
                            ", "
                          )}]\\nMove: ${
                            paramObj.move ? paramObj.move.join(", ") : "—"
                          }`;

                          return (
                            <div key={pIdx} className="param-item">
                              <div className="param-header">
                                <div className="param-name">
                                  {paramObj.param}
                                </div>
                                <button
                                  className="copy-button"
                                  onClick={() => copyToClipboard(paramCopyText)}
                                >
                                  <svg
                                    id="closedLoans"
                                    width="100%"
                                    height="100%"
                                    viewBox="0 0 13 9"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                  >
                                    <path
                                      d="M11.5 1L4.5 8L1 4.5"
                                      stroke="#525252"
                                      strokeWidth="1.4"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              </div>

                              <div className="param-details">
                                <div className="param-detail">
                                  <span>
                                    <b>Start:</b>{" "}
                                    {paramObj.startValue.join(", ")}
                                  </span>
                                  <span>
                                    <b>End:</b> {paramObj.endValue.join(", ")}
                                  </span>
                                </div>

                                {(showIn || showOut) && (
                                  <div className="param-detail">
                                    <span>
                                      <b>Speed In:</b>{" "}
                                      {showIn
                                        ? `[${paramObj.inSpeed.join(", ")}]`
                                        : "—"}
                                    </span>
                                    <span>
                                      <b>Out:</b>{" "}
                                      {showOut
                                        ? `[${paramObj.outSpeed.join(", ")}]`
                                        : "—"}
                                    </span>
                                  </div>
                                )}

                                {paramObj.move && (
                                  <div className="param-detail">
                                    <b>Move:</b> [{paramObj.move.join(", ")}]
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
