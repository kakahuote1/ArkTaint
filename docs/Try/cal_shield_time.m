function [shield_time,t_begin,t_end] = cal_shield_time(alpha,beta1,beta2,ans1,MS)
realPosRoots = ans1(isreal(ans1) & ans1 > 0);
numRealPosRoots = length(realPosRoots);
syms tt theta;
if numRealPosRoots==2  % 进入烟雾弹
    t_begin = ans1(1); t_end = ans1(2);
    for i=ans1(1):-0.1:0
        beta1_max = 0; beta2_max = 0;
        for j=0:pi/2:2*pi
            if beta1_max<double(subs(beta1,{tt,theta},{i,j}))
                beta1_max = double(subs(beta1,{tt,theta},{i,j}));
            end
        end
        if beta1_max>double(subs(alpha,tt,i))
            t_begin = i+0.1;
            break
        end
        for j=0:pi/2:2*pi
            if beta2_max<double(subs(beta2,{tt,theta},{i,j}))
                beta2_max = double(subs(beta2,{tt,theta},{i,j}));
            end
        end
        if beta2_max>double(subs(alpha,tt,i))
            t_begin = i+0.1;
            break
        end
    end
    for i=t_begin:-0.02:t_begin-0.1
        beta1_max = 0; beta2_max = 0;
        for j=0:pi/2:2*pi
            if beta1_max<double(subs(beta1,{tt,theta},{i,j}))
                beta1_max = double(subs(beta1,{tt,theta},{i,j}));
            end
        end
        if beta1_max>double(subs(alpha,tt,i))
            t_begin = i+0.02;
            break
        end
        for j=0:pi/2:2*pi
            if beta2_max<double(subs(beta2,{tt,theta},{i,j}))
                beta2_max = double(subs(beta2,{tt,theta},{i,j}));
            end
        end
        if beta2_max>double(subs(alpha,tt,i))
            t_begin = i+0.02;
            break
        end
    end
    % for i=t_begin:-0.001:t_begin-0.01
    %     beta1_max = 0; beta2_max = 0;
    %     for j=0:pi/100:2*pi
    %         if beta1_max<double(subs(beta1,{tt,theta},{i,j}))
    %             beta1_max = double(subs(beta1,{tt,theta},{i,j}));
    %         end
    %     end
    %     if beta1_max>subs(alpha,tt,i)
    %         t_begin = i+0.001;
    %         break
    %     end
    %     for j=0:pi/100:2*pi
    %         if beta2_max<double(subs(beta2,{tt,theta},{i,j}))
    %             beta2_max = double(subs(beta2,{tt,theta},{i,j}));
    %         end
    %     end
    %     if beta2_max>subs(alpha,tt,i)
    %         t_begin = i+0.001;
    %         break
    %     end
    % end
    shield_time = t_end - t_begin;
elseif numRealPosRoots==0  % 不进入烟雾弹
    MS = double(subs(MS,tt,0));
    if (MS(1)>0)||(MS(3)>0)
        shield_time = 0;
        return
    end
    t_max = (sqrt(sum(MS.^2)))/300;
    if t_max>20
        t_max = 20;
    end
    flag = 0; t_begin = 0; t_end = 0;
    for i=0:0.2:t_max
        beta1_max = 0; beta2_max = 0;
        for j=0:pi/2:2*pi
            if beta1_max<double(subs(beta1,{tt,theta},{i,j}))
                beta1_max = double(subs(beta1,{tt,theta},{i,j}));
            end
        end
        for j=0:pi/2:2*pi
            if beta2_max<double(subs(beta2,{tt,theta},{i,j}))
                beta2_max = double(subs(beta2,{tt,theta},{i,j}));
            end
        end
        if (beta1_max<subs(alpha,tt,i))&&(beta2_max<subs(alpha,tt,i))
            if flag==0  % 开始遮蔽
                flag = 1;
                t_begin = i;
            end
        else
            if flag==1  % 结束遮蔽
                t_end = i-0.2;
                break
            end
        end
    end
    if t_end==0
        shield_time = 0;
        return
    end
    if t_begin~=0
        for i=t_begin-0.2:0.03:t_begin
            beta1_max = 0; beta2_max = 0;
            for j=0:pi/2:2*pi
                if beta1_max<double(subs(beta1,{tt,theta},{i,j}))
                    beta1_max = double(subs(beta1,{tt,theta},{i,j}));
                end
            end
            if beta1_max>subs(alpha,tt,i)
                t_begin = i+0.03;
                break
            end
            for j=0:pi/2:2*pi
                if beta2_max<double(subs(beta2,{tt,theta},{i,j}))
                    beta2_max = double(subs(beta2,{tt,theta},{i,j}));
                end
            end
            if beta2_max>subs(alpha,tt,i)
                t_begin = i+0.03;
                break
            end
        end
    end
    for i=t_end:0.03:t_end+0.2
        beta1_max = 0; beta2_max = 0;
        for j=0:pi/2:2*pi
            if beta1_max<double(subs(beta1,{tt,theta},{i,j}))
                beta1_max = double(subs(beta1,{tt,theta},{i,j}));
            end
        end
        if beta1_max>subs(alpha,tt,i)
            t_end = i-0.03;
            break
        end
        for j=0:pi/2:2*pi
            if beta2_max<double(subs(beta2,{tt,theta},{i,j}))
                beta2_max = double(subs(beta2,{tt,theta},{i,j}));
            end
        end
        if beta2_max>subs(alpha,tt,i)
            t_end = i-0.03;
            break
        end
    end
    shield_time = t_end-t_begin;
else
    fp = ['正实数根的个数为: ',num2str(numRealPosRoots)];
    disp(fp)
end