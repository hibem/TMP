document.addEventListener('DOMContentLoaded', () => {
    // 获取 DOM 元素
    const generateBtn = document.getElementById('generate-btn');
    const downloadBtn = document.getElementById('download-btn');
    const svgPreview = document.getElementById('svg-preview');
    const config = {}; // 用于存储当前配置的对象
    let inputDebounceTimeout; // For debouncing input events

    // --- 辅助函数 ---
    function degreesToRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    function radiansToDegrees(radians) {
        return radians * (180 / Math.PI);
    }

    function getPointOnCircle(cx, cy, radius, angleDegrees) {
        const angleRadians = degreesToRadians(angleDegrees - 90); // 0度在顶部
        return {
            x: cx + radius * Math.cos(angleRadians),
            y: cy + radius * Math.sin(angleRadians)
        };
    }

    function chordToAngle(chordLength, radius) {
        if (radius <= 0 || chordLength < 0 || chordLength > 2 * radius + 1e-9) {
            // console.warn(`无效弦长/半径: chord=${chordLength}, radius=${radius}`);
            return NaN;
        }
        if (chordLength === 0) return 0;
        const ratio = Math.min(1, chordLength / (2 * radius));
        const angleRadians = 2 * Math.asin(ratio);
        return radiansToDegrees(angleRadians);
    }

    /**
     * 根据角度和半径计算弦长
     * @param {number} angleDegrees - 圆心角 (度)
     * @param {number} radius - 半径
     * @returns {number} 弦长
     */
    function angleToChord(angleDegrees, radius) {
        if (radius <= 0 || angleDegrees < 0 || angleDegrees > 360) {
             return NaN;
        }
        const angleRadians = degreesToRadians(angleDegrees);
        return 2 * radius * Math.sin(angleRadians / 2);
    }


    // --- 默认标度区间角度定义 ---
    // key: "min_max", value: array of angles for intervals
    // 这些是估计值，可以根据实际需要调整，总角度尽量接近 270 度
    const defaultIntervalAngles = {
        "-40_80": [45, 45, 45, 45, 45, 45],              // 120 range / 6 = 20 step -> 6 * 45 = 270 deg
        "0_50":   [54, 54, 54, 54, 54],                  // 50 range / 5 = 10 step -> 5 * 54 = 270 deg
        "0_100":  [54, 54, 54, 54, 54],                  // 100 range / 5 = 20 step -> 5 * 54 = 270 deg
        "0_150":  [54, 54, 54, 54, 54],                  // 150 range / 5 = 30 step -> 5 * 54 = 270 deg
        "0_200":  [54, 54, 54, 54, 54],                  // 200 range / 5 = 40 step -> 5 * 54 = 270 deg
        "0_300":  [45, 45, 45, 45, 45, 45],              // 300 range / 6 = 50 step -> 6 * 45 = 270 deg
        "0_350":  [38.57, 38.57, 38.57, 38.57, 38.57, 38.57, 38.57], // 350 range / 7 = 50 step -> 7 * 38.57 ~= 270
        "0_400":  [33.75, 33.75, 33.75, 33.75, 33.75, 33.75, 33.75, 33.75], // 400 range / 8 = 50 step -> 8 * 33.75 = 270
        "0_500":  [27, 27, 27, 27, 27, 27, 27, 27, 27, 27], // 500 range / 10 = 50 step -> 10 * 27 = 270
        // 可以为特定范围添加更精确的非线性默认值, 例如:
        // "0_150": [46.34, 48.81, 48.56, 48.78, 17.51], // 来自原始图的示例(最后一个是推算的?) -> Sum != 270
    };

    // --- SVG 生成核心函数 ---
    function generateSVG() {
        // console.log("开始生成 SVG...");

        // 1. 收集配置信息
        config.dialSize = parseFloat(document.getElementById('dial-size').value);
        const selectedModelSuffix = document.querySelector('input[name="panel-model-suffix"]:checked').value;
        let wssPrefix = '4'; // Default for 100
        if (config.dialSize == 60) wssPrefix = '3';
        else if (config.dialSize == 150) wssPrefix = '5';
        config.panelModelString = `WSS-${wssPrefix}${selectedModelSuffix}`; // Store the full string

        // 修改: 读取公司名称
        config.companyName = document.getElementById('company-name').value;
        config.productNo = document.getElementById('product-no').value;
        config.initialChordLength = parseFloat(document.getElementById('initial-chord-length').value);

        const selectedRangeRadio = document.querySelector('input[name="temp-range"]:checked');
        config.tempMin = parseFloat(selectedRangeRadio.dataset.min);
        config.tempMax = parseFloat(selectedRangeRadio.dataset.max);
        config.tempRange = config.tempMax - config.tempMin;

        config.intervalChordLengths = Array.from(document.querySelectorAll('#scale-intervals .interval-chord'))
                                     .map(input => parseFloat(input.value) || 0);

        // console.log("当前配置:", config);

        // --- SVG 绘图参数 ---
        const svgSize = 200;
        const cx = svgSize / 2;
        const cy = svgSize / 2;
        const outerRadius = svgSize * 0.48; // Used for chord calculations
        const tickRadius = svgSize * 0.45;
        const longTickLength = svgSize * 0.08;
        const shortTickLength = svgSize * 0.04;
        const labelRadius = svgSize * 0.35;
        const baseFontSize = svgSize * 0.05; // Base size for labels
        const infoFontSize = baseFontSize * 0.8; // Smaller size for info text

        // --- 计算总角度 (Sweep Angle) ---
        let totalSweepAngle = NaN;
        let useNonLinearScale = false;
        let intervalAngles = [];

        // Priority 1: Use interval chords
        if (config.intervalChordLengths.some(chord => chord > 0)) {
            intervalAngles = config.intervalChordLengths.map(chord => chordToAngle(chord, outerRadius));
            if (intervalAngles.every(angle => !isNaN(angle) && angle >= 0)) { // Allow 0 angle
                totalSweepAngle = intervalAngles.reduce((sum, angle) => sum + angle, 0);
                if (totalSweepAngle > 0 && totalSweepAngle <= 360) {
                    useNonLinearScale = true;
                    // console.log(`使用分段弦长计算角度, 总角度: ${totalSweepAngle.toFixed(2)} 度`);
                } else {
                    // console.warn(`分段弦长计算出的总角度 (${totalSweepAngle.toFixed(2)}) 无效.`);
                    totalSweepAngle = NaN;
                }
            } else {
                 // console.warn("部分或全部分段弦长无法计算有效角度.");
                 totalSweepAngle = NaN;
            }
        }

        // Priority 2: Use initial chord length (fallback if intervals fail)
        if (!useNonLinearScale && !isNaN(config.initialChordLength) && config.initialChordLength > 0) {
            totalSweepAngle = chordToAngle(config.initialChordLength, outerRadius);
            if (!isNaN(totalSweepAngle) && totalSweepAngle > 0 && totalSweepAngle <= 360) {
                 // console.log(`使用初始弦长计算角度, 总角度: ${totalSweepAngle.toFixed(2)} 度`);
                 // Keep useNonLinearScale = false
            } else {
                // console.warn(`初始弦长 (${config.initialChordLength}) 无法计算有效角度.`);
                totalSweepAngle = NaN;
            }
        }

        // Priority 3: Default angle
        if (isNaN(totalSweepAngle) || totalSweepAngle <= 0 || totalSweepAngle > 360) {
            // console.warn("无法从弦长计算有效角度，使用默认 270 度。");
            totalSweepAngle = 270;
            useNonLinearScale = false;
            intervalAngles = []; // Ensure interval angles are cleared if using default
        }

        const startAngle = -totalSweepAngle / 2;
        const endAngle = totalSweepAngle / 2;

        // --- 构建 SVG 字符串 ---
        let svgContent = `<svg width="${config.dialSize}mm" height="${config.dialSize}mm" viewBox="0 0 ${svgSize} ${svgSize}" xmlns="http://www.w3.org/2000/svg" font-family="Arial, 'Microsoft YaHei', sans-serif">`; // Added YaHei
        svgContent += `<style>
            .tick { stroke: black; stroke-width: 0.5; }
            .label { font-size: ${baseFontSize}px; text-anchor: middle; dominant-baseline: central; fill: black; } /* Use central baseline */
            .title-text { font-size: ${infoFontSize * 1.1}px; font-weight: bold; text-anchor: middle; dominant-baseline: central; fill: black; }
            .model-text { font-size: ${infoFontSize}px; text-anchor: middle; dominant-baseline: central; fill: black; }
            /* 修改: .info-text 用于公司名和编号, 字体略小 */
            .info-text { font-size: ${infoFontSize * 0.9}px; text-anchor: middle; dominant-baseline: central; fill: black; }
            .unit-text { font-size: ${infoFontSize}px; text-anchor: middle; dominant-baseline: central; fill: black; } /* 单独的单位样式 */
        </style>`;
        svgContent += `<circle cx="${cx}" cy="${cy}" r="${outerRadius}" fill="white" stroke="black" stroke-width="0.5"/>`;
        svgContent += `<circle cx="${cx}" cy="${cy}" r="${svgSize * 0.02}" fill="black"/>`;

        // --- 绘制刻度和标签 ---
        if (!useNonLinearScale) {
            // **绘制线性刻度**
            let majorTickInterval = config.tempRange === 0 ? 1 : config.tempRange / 5; // Avoid division by zero
            if (config.tempRange > 150 && config.tempRange != 0) majorTickInterval = config.tempRange / 10;
            if (config.tempRange > 300 && config.tempRange != 0) majorTickInterval = config.tempRange / 5;
            majorTickInterval = Math.max(1, Math.round(majorTickInterval / 10) * 10 || 10);
            let minorTickInterval = majorTickInterval / 5;
            if (minorTickInterval < 1) minorTickInterval = 1;
            if (!Number.isInteger(minorTickInterval) && majorTickInterval > 1) minorTickInterval = Math.round(majorTickInterval / 2);
            else if (!Number.isInteger(minorTickInterval)) minorTickInterval = 1;

            for (let temp = config.tempMin; temp <= config.tempMax; temp += minorTickInterval) {
                 const currentTemp = parseFloat(temp.toFixed(5));
                 if (currentTemp > config.tempMax + 1e-9) break;
                 if (config.tempRange === 0 && currentTemp > config.tempMax) break; // Handle zero range case

                 const isMajorTick = config.tempRange === 0 || Math.abs((currentTemp - config.tempMin) % majorTickInterval) < 1e-9 || Math.abs(currentTemp - config.tempMax) < 1e-9;
                 const tickLength = isMajorTick ? longTickLength : shortTickLength;
                 const angle = startAngle + (config.tempRange === 0 ? 0 : ((currentTemp - config.tempMin) / config.tempRange) * totalSweepAngle);

                 const p1 = getPointOnCircle(cx, cy, tickRadius, angle);
                 const p2 = getPointOnCircle(cx, cy, tickRadius - tickLength, angle);
                 svgContent += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" class="tick" />`;

                 if (isMajorTick) {
                     const labelPos = getPointOnCircle(cx, cy, labelRadius, angle);
                     if (totalSweepAngle === 0 || (Math.abs(angle - startAngle) > baseFontSize / labelRadius * 90 / Math.PI && Math.abs(angle - endAngle) > baseFontSize / labelRadius * 90 / Math.PI)) {
                        svgContent += `<text x="${labelPos.x}" y="${labelPos.y}" class="label">${Math.round(currentTemp)}</text>`;
                     }
                 }
                 if (config.tempRange === 0) break; // Only draw one set of ticks for zero range
            }
             // Ensure start/end labels
             const startLabelPos = getPointOnCircle(cx, cy, labelRadius, startAngle);
             svgContent += `<text x="${startLabelPos.x}" y="${startLabelPos.y}" class="label">${Math.round(config.tempMin)}</text>`;
             if (config.tempMin !== config.tempMax || totalSweepAngle > 0) {
                const endLabelPos = getPointOnCircle(cx, cy, labelRadius, endAngle);
                svgContent += `<text x="${endLabelPos.x}" y="${endLabelPos.y}" class="label">${Math.round(config.tempMax)}</text>`;
             }

        } else {
            // **绘制非线性刻度**
            let currentAngle = startAngle;
            const intervalDivs = document.querySelectorAll('#scale-intervals div');

            intervalDivs.forEach((div, index) => {
                const labelText = div.querySelector('label').textContent;
                const matches = labelText.match(/([\d.-]+)~([\d.-]+)℃/);
                if (!matches || matches.length < 3) return;

                const intervalMinTemp = parseFloat(matches[1]);
                const intervalMaxTemp = parseFloat(matches[2]);
                const intervalTempRange = intervalMaxTemp - intervalMinTemp;
                const angleSpan = intervalAngles[index]; // Use pre-calculated angle

                if (isNaN(angleSpan) || angleSpan < 0 || intervalTempRange < 0) return; // Allow zero angleSpan/tempRange

                // Calculate ticks within this interval
                let majorTickInterval = intervalTempRange === 0 ? 1 : intervalTempRange / 2 || 10;
                majorTickInterval = Math.max(1, Math.round(majorTickInterval / 5) * 5 || 5);
                let minorTickInterval = majorTickInterval / 5 || 1;
                minorTickInterval = Math.max(1, Math.round(minorTickInterval));


                for (let temp = intervalMinTemp; temp <= intervalMaxTemp; temp += minorTickInterval) {
                    const currentTemp = parseFloat(temp.toFixed(5));
                    if (currentTemp > intervalMaxTemp + 1e-9) break;
                     if (intervalTempRange === 0 && currentTemp > intervalMaxTemp) break;

                    const ratioInInterval = (intervalTempRange === 0) ? 0 : (currentTemp - intervalMinTemp) / intervalTempRange;
                    const angle = currentAngle + ratioInInterval * angleSpan;

                    const isMajorTick = intervalTempRange === 0 || currentTemp === intervalMinTemp || Math.abs((currentTemp - intervalMinTemp) % majorTickInterval) < 1e-9 || Math.abs(currentTemp - intervalMaxTemp) < 1e-9;
                    const tickLength = isMajorTick ? longTickLength : shortTickLength;

                    const p1 = getPointOnCircle(cx, cy, tickRadius, angle);
                    const p2 = getPointOnCircle(cx, cy, tickRadius - tickLength, angle);
                    svgContent += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" class="tick" />`;

                    if (isMajorTick && currentTemp !== config.tempMin && currentTemp !== config.tempMax) {
                        const labelPos = getPointOnCircle(cx, cy, labelRadius, angle);
                         svgContent += `<text x="${labelPos.x}" y="${labelPos.y}" class="label">${Math.round(currentTemp)}</text>`;
                    }
                     if (intervalTempRange === 0) break; // Only one set of ticks for zero range
                }
                currentAngle += angleSpan;
            });

            // Ensure start/end labels
            const startLabelPos = getPointOnCircle(cx, cy, labelRadius, startAngle);
            svgContent += `<text x="${startLabelPos.x}" y="${startLabelPos.y}" class="label">${Math.round(config.tempMin)}</text>`;
             if (config.tempMin !== config.tempMax || totalSweepAngle > 0) {
                 const endLabelPos = getPointOnCircle(cx, cy, labelRadius, endAngle);
                 svgContent += `<text x="${endLabelPos.x}" y="${endLabelPos.y}" class="label">${Math.round(config.tempMax)}</text>`;
             }
        }

        // --- 添加中心文本 ---
        let textY = cy - outerRadius * 0.35; // Adjusted Y position (higher)
        svgContent += `<text x="${cx}" y="${textY}" class="title-text">双金属温度计</text>`;

        textY += infoFontSize * 1.3; // Space between title and model
        if (config.panelModelString) {
             svgContent += `<text x="${cx}" y="${textY}" class="model-text">${config.panelModelString}</text>`;
        }

        // Unit "°C" - Below center using specific class
        textY = cy + outerRadius * 0.3; // Reset Y for below center
        svgContent += `<text x="${cx}" y="${textY}" class="unit-text">°C</text>`; // Use .unit-text

        // Company Name and Product Number - Lower down using .info-text class
        textY = cy + outerRadius * 0.65; // Adjust starting Y position lower
        if (config.companyName) {
             // 修改: 直接显示公司名称，无前缀
             svgContent += `<text x="${cx}" y="${textY}" class="info-text">${config.companyName}</text>`;
             textY += infoFontSize * 1.1; // Increase spacing slightly
        }
        if (config.productNo) {
             // 修改: 将 P.No: 改为 No:
             svgContent += `<text x="${cx}" y="${textY}" class="info-text">No: ${config.productNo}</text>`;
        }


        // --- 结束 SVG ---
        svgContent += `</svg>`;
        svgPreview.innerHTML = svgContent;
        // console.log("SVG 生成完毕.");
    }

    // --- SVG 下载函数 ---
    function downloadSVG() {
         const svgData = svgPreview.innerHTML;
         if (!svgData || svgData.trim() === '') {
             alert("请先生成预览！");
             return;
         }
         const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
         const url = URL.createObjectURL(blob);
         const a = document.createElement('a');
         a.href = url;
         const filename = `温度计面板-Φ${config.dialSize}-${config.tempMin}-${config.tempMax}C.svg`;
         a.download = filename;
         document.body.appendChild(a);
         a.click();
         document.body.removeChild(a);
         URL.revokeObjectURL(url);
         // console.log("SVG 已触发下载:", filename);
    }

    // --- 动态更新标度区间输入框 ---
    function updateScaleIntervalInputs() {
        const selectedRangeRadio = document.querySelector('input[name="temp-range"]:checked');
        if (!selectedRangeRadio) return;

        const min = parseFloat(selectedRangeRadio.dataset.min);
        const max = parseFloat(selectedRangeRadio.dataset.max);
        const range = max - min;
        const rangeKey = `${min}_${max}`; // Key for default lookup
        const intervalsContainer = document.getElementById('scale-intervals');
        intervalsContainer.innerHTML = '';

        // Decide interval step (adjust logic as needed)
        let step = 30;
        if (range <= 0) step = 1; // Handle zero or negative range
        else if (range <= 50) step = 10;
        else if (range <= 100) step = 20;
        else if (range <= 200) step = 40;
        else if (range <= 350) step = 50; // Adjusted steps
        else if (range <= 400) step = 50; // Keep 50 step for 400
        else step = Math.max(10, Math.round(range / 10 / 10) * 10); // Divide into ~10 steps for larger ranges


        // Get default angles for the current range
        const defaultAngles = defaultIntervalAngles[rangeKey] || [];
        let intervalIndex = 0;

        // Create inputs for each interval
        for (let currentMin = min; currentMin < max || (range === 0 && intervalIndex === 0) ; currentMin += step) {
            let currentMax = (range === 0) ? min : Math.min(currentMin + step, max);

            const div = document.createElement('div');
            const label = document.createElement('label');
            label.textContent = `${currentMin}~${currentMax}℃ 弦长:`;
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'interval-chord';
            input.step = 'any';

            // --- Calculate and set default chord length ---
            const defaultAngle = defaultAngles[intervalIndex];
            if (typeof defaultAngle === 'number' && !isNaN(defaultAngle)) {
                const radiusForChord = (200 * 0.48); // svgSize * outerRadius ratio
                const defaultChord = angleToChord(defaultAngle, radiusForChord);
                if (!isNaN(defaultChord)) {
                    input.value = defaultChord.toFixed(2); // Set default value
                } else {
                     input.placeholder = "默认角度无效";
                }
            } else {
                 input.placeholder = "无默认值"; // Or just empty
            }

            div.appendChild(label);
            div.appendChild(input);
            intervalsContainer.appendChild(div);
            intervalIndex++;

            if (range === 0) break; // Only one interval for zero range
            if (currentMax >= max) break; // Ensure loop terminates correctly
        }
    }

    // --- 事件监听器 ---
    generateBtn.addEventListener('click', generateSVG);
    downloadBtn.addEventListener('click', downloadSVG);

    // Update intervals and preview when range changes
    document.querySelectorAll('input[name="temp-range"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateScaleIntervalInputs();
            generateSVG();
        });
    });

    // Update preview when other inputs change (with debounce)
    document.querySelector('.config-panel').addEventListener('input', (event) => {
        // Exclude buttons from triggering immediate redraw on 'input'
        if (event.target.tagName !== 'BUTTON') {
            clearTimeout(inputDebounceTimeout);
            inputDebounceTimeout = setTimeout(generateSVG, 300); // 300ms delay
        }
    });
     // Also trigger redraw immediately if select/radio changes
     document.querySelector('.config-panel').addEventListener('change', (event) => {
         if (event.target.tagName === 'SELECT' || event.target.type === 'radio') {
             clearTimeout(inputDebounceTimeout); // Clear any pending debounce
             // Range change handles its own update, only trigger for others
             if (!event.target.name.startsWith('temp-range')) {
                 generateSVG();
             }
         }
     });


    // --- 初始化 ---
    updateScaleIntervalInputs(); // Initialize intervals based on default checked range
    generateSVG(); // Generate initial preview
});
