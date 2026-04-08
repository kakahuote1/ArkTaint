%%% 差分遗传算法
clc,clear,format short;
bounds = [3.7,4.6;71.19,82.19;4,16;0,10];
popsize = 200; mutate = 0.5; recombination = 0.7; maxiter = 20;

n = length(bounds);
population = zeros(popsize,n);
for i=1:popsize
    indv = zeros(1,n);
    for j=1:n
        indv(j) = unifrnd(bounds(j,1),bounds(j,2));
    end
    % indv = create_indv(bounds);
    population(i,:) = indv;
end
best_score = []; gen_score = []; gen_sol = population(1);
for i=1:maxiter
    fp = ['Generation:',num2str(i)];
    disp(fp)
    gen_scores = [];
    for j=1:popsize
        candidates = 1:popsize;
        candidates(j) = [];
        random_index = randsample(candidates,4);
        x_1 = population(random_index(1),:);
        x_2 = population(random_index(2),:);
        x_3 = population(random_index(3),:);
        x_4 = population(random_index(4),:);
        x_t = population(j,:);

        x_diff1 = x_1-x_2; x_diff2 = x_3-x_4;
        v_donor = gen_sol+mutate*(x_diff1+x_diff2);
        v_donor = ensure_bounds(v_donor,bounds);

        for k=1:n
            crossover = rand();
            if crossover<=recombination
                v_trial(k) = v_donor(k);
            else
                v_trial(k) = x_t(k);
            end
        end
        score_trial = cal_indv(v_trial);
        score_target = cal_indv(x_t);
        if score_trial>score_target
            population(j,:) = v_trial;
            gen_scores = [gen_scores score_trial];
            fp = ['>',num2str(score_trial),' | ',num2str(v_trial)];
            disp(fp)
        else
            gen_scores = [gen_scores score_target];
            fp = ['>',num2str(score_target),' | ',num2str(x_t)];
            disp(fp)
        end
        if gen_scores(end)>0
            return
        end
    end
    gen_avg = sum(gen_scores)/popsize;
    [gen_best, idx] = max(gen_scores);
    gen_sol = population(idx, :);
    best_score = [best_score gen_best]; gen_score = [gen_score gen_avg];
    fp = ['>Generation Average: ',num2str(gen_avg)];
    disp(fp)
    fp = ['>Generation Best: ',num2str(gen_best)];
    disp(fp)
    fp = ['>Best Solution: ',num2str(gen_sol)];
    disp(fp)
end