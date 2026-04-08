clc,clear,format long
Missile1 = Missile([20000,0,2000]);
UAV_coords = [12000,1400,1400];
UAV_v = 80.8845; UAV_theta = 3.91954; t1 = 16.0208; delta_t1 = 8.22203;
% UAV_v = 120; UAV_theta = pi;
UAV1 = UAV(UAV_coords,UAV_v,UAV_theta);
t = t1;
[Missile1,~] = Missile1.update_coord(t);
[UAV1,~] = UAV1.update_coord(t);
[SmokeShell1,UAV1] = SmokeShell(UAV1);
t = t+delta_t1;
[SmokeShell1,~] = SmokeShell1.detonate(delta_t1);
[Missile1,~] = Missile1.update_coord(t);
[UAV1,~] = UAV1.update_coord(t);
syms tt theta;
coord_m = Missile1.cal_coord(tt+t);
coord_s = SmokeShell1.cal_sink_coord(tt);
distant = sqrt(sum((coord_s-coord_m).^2));
ans1 = double(solve(distant==10,tt));
% Missile1.cal_coord(ans1(1)+t)
% SmokeShell1.cal_sink_coord(ans1(1))

coord_m = Missile1.cal_coord(tt+t);
coord_s = SmokeShell1.cal_sink_coord(tt);
coord_o = sym([0,200,0])+[7*cos(theta),7*sin(theta),0];
MO = coord_o-coord_m; MS = coord_s-coord_m;
beta1 = acos(sum(MO.*MS)/sqrt(sum(MO.^2))/sqrt(sum(MS.^2)));
coord_o = sym([0,200,10])+[7*cos(theta),7*sin(theta),0];
MO = coord_o-coord_m; MS = coord_s-coord_m;
beta2 = acos(sum(MO.*MS)/sqrt(sum(MO.^2))/sqrt(sum(MS.^2)));
% for i=1:101
%     for j=1:101
%         ii = 0.2*(i-1); jj = pi/50*(j-1);
%         a(j,i) = double(subs(beta,{tt,theta},{ii,jj}));
%     end
% end
% [x, y] = meshgrid(0:0.2:20, 0:pi/50:2*pi);
% surf(x,y,a); shading interp;
% xlabel("theta"),ylabel("tt")
alpha = asin(10/sqrt(sum(MS.^2)));
tic;
[shield_time,t_begin,t_end] = cal_shield_time(alpha,beta1,beta2,ans1,MS);
toc;