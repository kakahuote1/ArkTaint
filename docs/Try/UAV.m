classdef UAV
    properties
        coord = zeros(1,3);
        v0; theta; v; coord_now = zeros(1,3); num_shell = 0;
    end

    methods
        function obj = UAV(coords,v0,theta)
            if nargin > 0
                obj.coord(1) = coords(1);
                obj.coord(2) = coords(2);
                obj.coord(3) = coords(3);
                obj.v0 = v0;
                obj.theta = theta;
                obj.v(1) = v0*cos(sym(theta));
                obj.v(2) = v0*sin(sym(theta));
                obj.v(3) = 0;
                obj.coord_now = obj.coord;
            end
        end

        function [obj,pres_coord] = update_coord(obj,t)
            pres_coord(1) = obj.coord(1)+obj.v(1)*t;
            pres_coord(2) = obj.coord(2)+obj.v(2)*t;
            pres_coord(3) = obj.coord(3);
            obj.coord_now = pres_coord;
        end

        function pres_coord = cal_coord(obj,t)
            pres_coord(1) = obj.coord(1)+obj.v(1)*t;
            pres_coord(2) = obj.coord(2)+obj.v(2)*t;
            pres_coord(3) = obj.coord(3);
        end
    end
end
