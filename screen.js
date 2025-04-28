// screen.js - Optimized screen rendering

// Optimized Screen class with WebGL rendering when available
export class Screen {
    constructor(canvas, pixelSize) {
        this.canvas = canvas;
        this.pixelSize = pixelSize || 1;
        this.useWebGL = this.initRenderer();
    }

    static get colors() {
        return [
            0xFF, // White
            0xAA, // Light gray
            0x55, // Dark gray
            0x00  // Black
        ];
    }

    static get physics() {
        return {
            WIDTH: 160,
            HEIGHT: 144,
            FREQUENCY: 60
        };
    }

    // Initialize either WebGL or Canvas 2D renderer
    initRenderer() {
        try {
            // Try to initialize WebGL for better performance
            this.gl = this.canvas.getContext('webgl', {
                alpha: false,
                antialias: false,
                depth: false,
                preserveDrawingBuffer: false
            });
            
            if (this.gl) {
                this.initWebGL();
                return true;
            }
        } catch (e) {
            console.warn('WebGL not supported, falling back to Canvas 2D');
        }
        
        // Fallback to Canvas 2D
        this.context = this.canvas.getContext('2d', {
            alpha: false,
            desynchronized: true,
            willReadFrequently: false
        });
        this.initImageData();
        return false;
    }

    // Initialize WebGL for hardware-accelerated rendering
    initWebGL() {
        const gl = this.gl;
        
        // Set up the viewport
        this.canvas.width = Screen.physics.WIDTH * this.pixelSize;
        this.canvas.height = Screen.physics.HEIGHT * this.pixelSize;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        
        // Create vertex shader
        const vertexShaderSource = `
            attribute vec2 position;
            attribute vec2 texCoord;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(position, 0, 1);
                v_texCoord = texCoord;
            }
        `;
        
        // Create fragment shader for GB color palette
        const fragmentShaderSource = `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_image;
            uniform vec4 u_colors[4];
            
            void main() {
                float colorIndex = texture2D(u_image, v_texCoord).r;
                int index = int(colorIndex * 255.0);
                
                if (index == 0) {
                    gl_FragColor = u_colors[0];
                } else if (index == 85) {
                    gl_FragColor = u_colors[1];
                } else if (index == 170) {
                    gl_FragColor = u_colors[2];
                } else {
                    gl_FragColor = u_colors[3];
                }
            }
        `;
        
        // Compile shaders
        const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
        
        // Create program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);
        
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('WebGL program link failed:', gl.getProgramInfoLog(this.program));
            this.useWebGL = false;
            this.context = this.canvas.getContext('2d');
            this.initImageData();
            return;
        }
        
        gl.useProgram(this.program);
        
        // Set up geometry - just a quad filling the screen
        const positions = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
             1,  1
        ]);
        
        const texCoords = new Float32Array([
            0, 1,
            1, 1,
            0, 0,
            1, 0
        ]);
        
        // Create buffers
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        
        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
        
        // Set up attributes
        this.positionLocation = gl.getAttribLocation(this.program, 'position');
        this.texCoordLocation = gl.getAttribLocation(this.program, 'texCoord');
        
        // Set up texture
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        
        // Set texture parameters
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        
        // Create empty texture data
        this.textureData = new Uint8Array(Screen.physics.WIDTH * Screen.physics.HEIGHT);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.LUMINANCE, Screen.physics.WIDTH, Screen.physics.HEIGHT, 
            0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.textureData
        );
        
        // Set up color uniform
        this.colorsLocation = gl.getUniformLocation(this.program, 'u_colors');
        
        // Define the GameBoy colors (white, light gray, dark gray, black)
        this.gbColors = [
            [1.0, 1.0, 1.0, 1.0],  // White
            [0.67, 0.67, 0.67, 1.0], // Light gray
            [0.33, 0.33, 0.33, 1.0], // Dark gray
            [0.0, 0.0, 0.0, 1.0]   // Black
        ];
        
        // Flatten the colors array for WebGL
        this.colorValues = new Float32Array(this.gbColors.flat());
        
        // Set the colors uniform
        gl.uniform4fv(this.colorsLocation, this.colorValues);
    }
    
    // Helper method to compile WebGL shaders
    compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('WebGL shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    }

    // Initialize Canvas 2D rendering
    initImageData() {
        this.canvas.width = Screen.physics.WIDTH * this.pixelSize;
        this.canvas.height = Screen.physics.HEIGHT * this.pixelSize;
        
        // Use the offscreen canvas API if available for better performance
        if (typeof OffscreenCanvas !== 'undefined') {
            this.offscreenCanvas = new OffscreenCanvas(this.canvas.width, this.canvas.height);
            this.offscreenContext = this.offscreenCanvas.getContext('2d', {
                alpha: false,
                desynchronized: true
            });
            this.imageData = this.offscreenContext.createImageData(this.canvas.width, this.canvas.height);
        } else {
            this.imageData = this.context.createImageData(this.canvas.width, this.canvas.height);
        }
    }

    setPixelSize(pixelSize) {
        this.pixelSize = pixelSize;
        if (this.useWebGL) {
            this.canvas.width = Screen.physics.WIDTH * this.pixelSize;
            this.canvas.height = Screen.physics.HEIGHT * this.pixelSize;
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        } else {
            this.initImageData();
        }
    }

    clearScreen() {
        if (this.useWebGL) {
            this.gl.clearColor(1, 1, 1, 1);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        } else {
            this.context.fillStyle = '#FFF';
            this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    // Optimized method to fill image data
    fillImageData(buffer) {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const pixelSize = this.pixelSize;
        const data = this.imageData.data;
        
        // Use Uint32Array view for faster pixel setting
        const buf32 = new Uint32Array(data.buffer);
        
        let i = 0;
        for (let y = 0; y < Screen.physics.HEIGHT; y++) {
            for (let py = 0; py < pixelSize; py++) {
                const row = y * Screen.physics.WIDTH;
                const targetRow = (y * pixelSize + py) * width;
                
                for (let x = 0; x < Screen.physics.WIDTH; x++) {
                    const v = Screen.colors[buffer[row + x]];
                    const color = 0xFF000000 | (v << 16) | (v << 8) | v;
                    
                    for (let px = 0; px < pixelSize; px++) {
                        buf32[targetRow + (x * pixelSize + px)] = color;
                    }
                }
            }
        }
    }

    // Optimized render method choosing between WebGL and Canvas 2D
    render(buffer) {
        if (this.useWebGL) {
            this.renderWebGL(buffer);
        } else {
            this.renderCanvas2D(buffer);
        }
    }
    
    // WebGL rendering path
    renderWebGL(buffer) {
        const gl = this.gl;
        
        // Copy buffer data to texture
        for (let i = 0; i < buffer.length; i++) {
            this.textureData[i] = Screen.colors[buffer[i]];
        }
        
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.LUMINANCE, Screen.physics.WIDTH, Screen.physics.HEIGHT, 
            0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.textureData
        );
        
        // Set up position attribute
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.positionLocation);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
        
        // Set up texcoord attribute
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(this.texCoordLocation);
        gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0);
        
        // Draw the quad
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    
    // Canvas 2D rendering path
    renderCanvas2D(buffer) {
        this.fillImageData(buffer);
        
        if (this.offscreenCanvas) {
            // Using OffscreenCanvas for better performance
            this.offscreenContext.putImageData(this.imageData, 0, 0);
            this.context.drawImage(this.offscreenCanvas, 0, 0);
        } else {
            // Direct rendering
            this.context.putImageData(this.imageData, 0, 0);
        }
    }
}