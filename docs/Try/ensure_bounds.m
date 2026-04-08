% 边界检验
function vec_new = ensure_bounds(vec,bounds)
N = length(vec);
for i=1:N
    if vec(i)<bounds(i,1)
        vec_new(i) = bounds(i,1);
    end
    if vec(i)>bounds(i,2)
        vec_new(i) = bounds(i,2);
    end
    if (vec(i)>=bounds(i,1))&&(vec(i)<=bounds(i,2))
        vec_new(i) = vec(i);
    end
end
