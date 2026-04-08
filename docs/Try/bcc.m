%% ===================== 1. 基础参数定义 =====================
fc = 40e3;          % 滤波器截止频率40kHz
fs = 500e3;         % 采样频率500kHz，远大于2*100kHz避免混叠
t_total = 0.001;    % 仿真总时长1ms
t = 0:1/fs:t_total-1/fs;  % 时间序列，步长为采样周期
N = length(t);      % 采样点数量
f = (0:N-1)*fs/N;   % 频率序列，用于频谱绘制

%% ===================== 2. 巴特沃斯低通滤波器设计 =====================
% butter函数：[b,a] = butter(n,Wn)，n为阶数，Wn为归一化截止频率(Wn=fc/(fs/2))
n = 4;              % 4阶巴特沃斯滤波器，兼顾效果与复杂度
Wn = fc/(fs/2);     % 归一化截止频率（MATLAB滤波器设计需归一化到0~1）
[b,a] = butter(n, Wn, 'low');  % 设计低通滤波器，b为分子系数，a为分母系数
% 验证滤波器幅频特性（可选，用于查看设计的滤波器是否符合要求）
[h,f_filter] = freqz(b,a,1024,fs); % 计算滤波器的频率响应

%% ===================== 3. 生成三种实验要求的输入信号 =====================
% 信号1：20kHz单音正弦波
f1 = 20e3;
x1 = sin(2*pi*f1*t);  % 单音正弦波信号生成

% 信号2：20kHz+40kHz+100kHz三音正弦波（等幅度叠加）
f2_1 = 20e3; f2_2 = 40e3; f2_3 = 100e3;
x2 = sin(2*pi*f2_1*t) + sin(2*pi*f2_2*t) + sin(2*pi*f2_3*t);

% 信号3：20kHz方波（占空比50%，利用square函数生成，幅度归一化到-1~1）
f3 = 20e3;
x3 = square(2*pi*f3*t,50);  % square(角频率,占空比)
x3 = x3/2;  % 幅度归一化，与正弦波幅度匹配

%% ===================== 4. 对三种输入信号进行滤波 =====================
% filter函数：y = filter(b,a,x)，用设计的滤波器对x滤波，输出y
y1 = filter(b,a,x1);  % 单音正弦波滤波输出
y2 = filter(b,a,x2);  % 三音正弦波滤波输出
y3 = filter(b,a,x3);  % 方波滤波输出


%% ===================== 6. 调用函数，分别绘制三种信号的仿真结果 =====================
plot_signal_analysis(x1, y1, t, f, fs, '20kHz单音正弦波');
plot_signal_analysis(x2, y2, t, f, fs, '20+40+100kHz三音正弦波');
plot_signal_analysis(x3, y3, t, f, fs, '20kHz方波');



%% ===================== 7. 绘制滤波器幅频特性图（单独展示） =====================
figure('Name','4阶巴特沃斯低通滤波器幅频特性','Position',[200,200,800,400]);
plot(f_filter/1000, 20*log10(abs(h)), 'b-', 'LineWidth',1.5);
xlabel('频率 (kHz)'); ylabel('幅度 (dB)');
title('4阶巴特沃斯低通滤波器幅频特性（fc=40kHz）');
grid on;
xlim([0,120]); ylim([-60,10]);
% 标记3dB截止频率
hold on; plot([40,40],[-60,10],'r--','LineWidth',1);
plot([0,120],[-3,-3],'g--','LineWidth',1);
text(42, -5, '40kHz(3dB截止频率)', 'Color','r');
text(100, -2, '-3dB', 'Color','g');
hold off;
%% ===================== 5. 定义仿真分析函数 =====================
% 函数功能：输入输入信号x、滤波输出y、信号名称name，绘制4类图：时域+频谱+自相关+功率谱
function plot_signal_analysis(x, y, t, f, fs, name)
    N = length(x);
    figure('Name',[name],'Position',[100,100,1200,800]); % 新建图形窗口
    set(gca,'FontSize',10); % 设置字体大小
    
    % 子图1：时域波形（输入+输出）
    subplot(2,2,1);
    plot(t*1000, x, 'b-', 'LineWidth',1); hold on;
    plot(t*1000, y, 'r-', 'LineWidth',1); hold off;
    xlabel('时间 (ms)'); ylabel('幅度');
    title([name,'-时域波形']);
    legend('输入信号','滤波输出','Location','best');
    grid on;
    
    % 子图2：频谱图（输入+输出，取前半段频率，避免镜像）
    X = fft(x)/N; Y = fft(y)/N; % 快速傅里叶变换，幅度归一化
    X_amp = 2*abs(X(1:N/2)); Y_amp = 2*abs(Y(1:N/2));
    f_half = f(1:N/2);
    subplot(2,2,2);
    plot(f_half/1000, X_amp, 'b-', 'LineWidth',1); hold on;
    plot(f_half/1000, Y_amp, 'r-', 'LineWidth',1); hold off;
    xlabel('频率 (kHz)'); ylabel('幅度');
    title([name,'-频谱图']);
    legend('输入信号','滤波输出','Location','best');
    grid on;
    xlim([0,120]); % 频率范围限定0~120kHz，聚焦实验关键频率
    
    % 子图3：自相关函数（输入+输出，xcorr默认计算无偏自相关）
    [Rxx,lags_x] = xcorr(x, 'unbiased'); [Ryy,lags_y] = xcorr(y, 'unbiased');
    subplot(2,2,3);
    plot(lags_x/fs*1000, Rxx, 'b-', 'LineWidth',1); hold on;
    plot(lags_y/fs*1000, Ryy, 'r-', 'LineWidth',1); hold off;
    xlabel('延迟 (ms)'); ylabel('自相关值');
    title([name,'-自相关函数']);
    legend('输入信号','滤波输出','Location','best');
    grid on;
    xlim([-0.5,0.5]); % 延迟范围限定，突出主瓣
    
    % 子图4：功率谱密度（pwelch法，更平滑，适合随机/周期信号）
    [Pxx,f_pxx] = pwelch(x, [], [], [], fs); [Pyy,f_pyy] = pwelch(y, [], [], [], fs);
    subplot(2,2,4);
    plot(f_pxx/1000, 10*log10(Pxx), 'b-', 'LineWidth',1); hold on;
    plot(f_pyy/1000, 10*log10(Pyy), 'r-', 'LineWidth',1); hold off;
    xlabel('频率 (kHz)'); ylabel('功率谱密度 (dB/Hz)');
    title([name,'-功率谱密度']);
    legend('输入信号','滤波输出','Location','best');
    grid on;
    xlim([0,120]);
end