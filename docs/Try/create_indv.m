function indv = create_indv(bounds)
n = length(bounds);
indv = zeros(1,n);
for j=1:n
    indv(j) = unifrnd(bounds(j,1),bounds(j,2));
end
flag1 = (12000+indv(2)*cos(indv(1))*(indv(3)+indv(4)))<=(19000-5700/sqrt(838)*(indv(3)+indv(4)));
flag2 = (0<=(1400-9.8/2*indv(4)^2))&&((1400-9.8/2*indv(4)^2)<=(70+2100-6300/sqrt(838)*(indv(3)+indv(4))));
flag3 = (0<=(1400+indv(2)*sin(indv(1))*(indv(3)+indv(4))))&&((1400+indv(2)*sin(indv(1))*(indv(3)+indv(4)))<=600);
while ~(flag1&&flag2&&flag3)
    for j=1:n
        indv(j) = unifrnd(bounds(j,1),bounds(j,2));
    end
    flag1 = (12000+indv(2)*cos(indv(1))*(indv(3)+indv(4)))<=(19000-5700/sqrt(838)*(indv(3)+indv(4)));
    flag2 = (0<=(1400-9.8/2*indv(4)^2))&&((1400-9.8/2*indv(4)^2)<=(70+2100-6300/sqrt(838)*(indv(3)+indv(4))));
    flag3 = (0<=(1400+indv(2)*sin(indv(1))*(indv(3)+indv(4))))&&((1400+indv(2)*sin(indv(1))*(indv(3)+indv(4)))<=600);
end